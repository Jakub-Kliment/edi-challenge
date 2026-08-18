import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/**
 * Fetching a URL supplied by an anonymous stranger, from a server that sits
 * inside a cloud network, is a textbook SSRF sink. Without care, someone posts
 * http://169.254.169.254/latest/meta-data/ and the server helpfully retrieves
 * its own cloud credentials.
 *
 * Layered defence:
 *   1. https only            — no file:, gopher:, data:
 *   2. resolve DNS, then check the resolved IP against private/reserved ranges
 *   3. refuse redirects      — otherwise a public URL 302s to a private one and
 *                              step 2 is bypassed. This is the step most
 *                              implementations miss.
 *   4. timeout               — no hanging the serverless function
 *   5. streamed size cap     — refuse to buffer a 2GB "image"
 *   6. magic-byte sniffing   — trust the bytes, not the Content-Type header
 *
 * Known residual risk: DNS rebinding. Between our lookup and the actual
 * connection, the name could resolve differently (TOCTOU). Fully closing this
 * means pinning the socket to the validated IP with a custom agent. For a
 * public testnet demo the layers above are proportionate; the gap is documented
 * rather than pretended away.
 */

export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // 10MB before any resizing
const FETCH_TIMEOUT_MS = 8_000;

export class ImageFetchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "IMAGE_URL_INVALID"
      | "IMAGE_URL_BLOCKED"
      | "IMAGE_UNREACHABLE"
      | "IMAGE_TOO_LARGE"
      | "IMAGE_NOT_AN_IMAGE",
  ) {
    super(message);
  }
}

/**
 * `new URL()` returns IPv6 hosts wrapped in brackets ("[::1]"), which
 * ipaddr.isValid() does not accept. Strip them before parsing, or every literal
 * IPv6 address silently skips the address check and falls through to DNS.
 */
function normalizeHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/** True when the address belongs to a range that must never be reachable. */
function isForbiddenAddress(addr: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  // Unwrap IPv4-mapped IPv6 FIRST. ::ffff:169.254.169.254 reports its range as
  // "ipv4Mapped", not "linkLocal", so judging by range alone would classify the
  // metadata endpoint on its disguise rather than on the address underneath.
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return isForbiddenAddress(v6.toIPv4Address());
    }
  }

  // ipaddr.js labels: unicast is the only category we allow. Everything else
  // (private, loopback, linkLocal, uniqueLocal, reserved, carrierGradeNat,
  // broadcast, multicast) is refused.
  return addr.range() !== "unicast";
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = normalizeHost(hostname);

  // A literal IP in the URL skips DNS entirely — validate it directly.
  if (ipaddr.isValid(host)) {
    if (isForbiddenAddress(ipaddr.parse(host))) {
      throw new ImageFetchError("That address range is not allowed.", "IMAGE_URL_BLOCKED");
    }
    return;
  }

  let results: Array<{ address: string }>;
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new ImageFetchError("Could not resolve that host.", "IMAGE_UNREACHABLE");
  }
  if (results.length === 0) {
    throw new ImageFetchError("Could not resolve that host.", "IMAGE_UNREACHABLE");
  }
  // EVERY resolved address must be public — a host resolving to both a public
  // and a private address must not be usable.
  for (const { address } of results) {
    if (!ipaddr.isValid(address) || isForbiddenAddress(ipaddr.parse(address))) {
      throw new ImageFetchError("That host resolves to a non-public address.", "IMAGE_URL_BLOCKED");
    }
  }
}

/** Detect real image types from their leading bytes, ignoring Content-Type. */
export function sniffImageMime(buf: Buffer): "image/webp" | "image/png" | "image/jpeg" | "image/gif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  return null;
}

/** Fetch an untrusted image URL under all of the protections above. */
export async function fetchImageSafely(rawUrl: string): Promise<{ buffer: Buffer; mime: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageFetchError("That does not look like a valid URL.", "IMAGE_URL_INVALID");
  }

  if (url.protocol !== "https:") {
    throw new ImageFetchError("Image links must start with https://", "IMAGE_URL_INVALID");
  }

  await assertPublicHost(url.hostname);

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "error", // critical: a followed redirect defeats the IP check
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "image/*" },
    });
  } catch (err) {
    const msg = (err as Error)?.name === "TimeoutError"
      ? "That image took too long to download."
      : "Could not download that image (the link may redirect, or be unreachable).";
    throw new ImageFetchError(msg, "IMAGE_UNREACHABLE");
  }

  if (!res.ok) {
    throw new ImageFetchError(`The image host returned ${res.status}.`, "IMAGE_UNREACHABLE");
  }

  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new ImageFetchError("That image is too large to download.", "IMAGE_TOO_LARGE");
  }

  // Stream so an unbounded/lying body cannot exhaust memory.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new ImageFetchError("Empty response from the image host.", "IMAGE_UNREACHABLE");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new ImageFetchError("That image is too large to download.", "IMAGE_TOO_LARGE");
    }
    chunks.push(value);
  }

  const buffer = Buffer.concat(chunks);
  const mime = sniffImageMime(buffer);
  if (!mime) {
    throw new ImageFetchError("That link does not point to a supported image.", "IMAGE_NOT_AN_IMAGE");
  }
  return { buffer, mime };
}
