import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchImageSafely, sniffImageMime, ImageFetchError } from "../lib/ssrf-guard.js";

/** The endpoint fetches URLs typed by anonymous strangers. These are the
 *  attacks that matters most, so they get explicit tests. */
describe("SSRF guard", () => {
  const mustReject = async (url: string, expected: string) => {
    await assert.rejects(
      async () => fetchImageSafely(url),
      (e: unknown) => {
        assert.ok(e instanceof ImageFetchError, `expected ImageFetchError for ${url}, got ${e}`);
        assert.equal((e as ImageFetchError).code, expected, `wrong code for ${url}`);
        return true;
      },
      `${url} must be rejected`
    );
  };

  it("blocks non-https schemes", async () => {
    await mustReject("http://example.com/a.png", "IMAGE_URL_INVALID");
    await mustReject("file:///etc/passwd", "IMAGE_URL_INVALID");
    await mustReject("ftp://example.com/a.png", "IMAGE_URL_INVALID");
    await mustReject("data:image/png;base64,iVBORw0KGgo=", "IMAGE_URL_INVALID");
    await mustReject("gopher://example.com/", "IMAGE_URL_INVALID");
  });

  it("blocks the cloud metadata endpoint", async () => {
    // The classic SSRF target: link-local, serves cloud credentials.
    await mustReject("https://169.254.169.254/latest/meta-data/", "IMAGE_URL_BLOCKED");
    await mustReject("https://[fd00::1]/x.png", "IMAGE_URL_BLOCKED");
  });

  it("blocks private and loopback ranges", async () => {
    for (const host of [
      "127.0.0.1", "localhost.localdomain",
      "10.0.0.1", "172.16.0.1", "192.168.1.1",
      "0.0.0.0", "[::1]",
    ]) {
      await mustReject(`https://${host}/image.png`, "IMAGE_URL_BLOCKED").catch(async () => {
        // Some hostnames fail to resolve instead of resolving privately —
        // also an acceptable rejection.
        await assert.rejects(async () => fetchImageSafely(`https://${host}/image.png`));
      });
    }
  });

  it("blocks IPv4-mapped IPv6 forms of private addresses", async () => {
    // ::ffff:169.254.169.254 is the metadata endpoint wearing a disguise.
    await mustReject("https://[::ffff:169.254.169.254]/", "IMAGE_URL_BLOCKED");
    await mustReject("https://[::ffff:127.0.0.1]/", "IMAGE_URL_BLOCKED");
  });

  it("rejects malformed URLs", async () => {
    await mustReject("not a url", "IMAGE_URL_INVALID");
    await mustReject("https://", "IMAGE_URL_INVALID");
  });

  it("sniffs image types from magic bytes, not headers", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
    const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(8)]);
    assert.equal(sniffImageMime(png), "image/png");
    assert.equal(sniffImageMime(jpeg), "image/jpeg");
    assert.equal(sniffImageMime(webp), "image/webp");
    assert.equal(sniffImageMime(gif), "image/gif");

    // An HTML page served as image/png must not pass.
    assert.equal(sniffImageMime(Buffer.from("<!DOCTYPE html><html>...")), null);
    assert.equal(sniffImageMime(Buffer.from("short")), null);
  });
});
