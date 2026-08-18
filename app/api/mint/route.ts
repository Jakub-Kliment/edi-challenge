import { NextResponse } from "next/server";
import { mintRequestSchema, type MintFailure, type MintSuccess } from "@/shared/schema";
import { fetchImageSafely, ImageFetchError } from "@/lib/ssrf-guard";
import { processImage, decodeDataUri, ImageProcessError, TARGET_BYTES } from "@/lib/image-server";
import {
  getClients, getContractAddress, withNonceLock, isNonceError,
  RelayerConfigError, type ChainKey,
} from "@/lib/relayer";
import { EXIT_BADGE_ABI } from "@/lib/abi";

/**
 * The public mint endpoint. Anyone can call it; nobody needs a wallet.
 *
 * Vercel Hobby allows 300s with Fluid Compute, and an Amoy transaction confirms
 * in ~2s, so a plain synchronous route is fine — no queue, no polling. 60s is
 * set as a guard against a hung upstream image fetch rather than as a limit we
 * expect to approach.
 */
export const maxDuration = 60;
export const runtime = "nodejs"; // sharp needs native binaries

const RECEIPT_TIMEOUT_MS = 45_000;

/** Coarse in-memory rate limit. See the note in lib/relayer.ts: serverless
 *  instances do not share memory, so this thins abuse rather than preventing
 *  it. The real backstop is that the relayer wallet holds very little. */
const recent = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    recent.set(ip, hits);
    return true;
  }
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear(); // crude unbounded-growth guard
  return false;
}

const fail = (code: string, message: string, status = 400) =>
  NextResponse.json<MintFailure>({ ok: false, code, message }, { status });

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return fail("RATE_LIMITED", "Too many badges from this address. Try again later.", 429);
  }

  // ---- validate ----------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", "Request body must be JSON.");
  }

  const parsed = mintRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail("VALIDATION_FAILED", first?.message ?? "Those details are not valid.");
  }
  const data = parsed.data;
  const chainKey = data.chain as ChainKey;

  if (chainKey === "polygon" && process.env.NEXT_PUBLIC_MAINNET_ENABLED !== "true") {
    return fail("MAINNET_DISABLED", "Mainnet minting is not enabled on this deployment.");
  }

  // ---- obtain and shrink the image ---------------------------------------
  let raw: Buffer;
  try {
    raw = data.imageUrl
      ? (await fetchImageSafely(data.imageUrl)).buffer
      : decodeDataUri(data.imageDataUri!);
  } catch (err) {
    if (err instanceof ImageFetchError || err instanceof ImageProcessError) {
      return fail(err.code, err.message);
    }
    return fail("IMAGE_UNREACHABLE", "Could not load that image.");
  }

  let processed;
  try {
    processed = await processImage(raw, TARGET_BYTES);
  } catch (err) {
    if (err instanceof ImageProcessError) return fail(err.code, err.message);
    return fail("IMAGE_INVALID", "Could not process that image.");
  }

  // ---- mint ---------------------------------------------------------------
  try {
    const { publicClient, walletClient, account, explorer } = getClients(chainKey);
    const contract = getContractAddress(chainKey);

    const badge = {
      firstName: data.firstName,
      lastName: data.lastName,
      mainProject: data.mainProject,
      startDate: data.startDate,
      completionDate: data.completionDate,
      details: data.details,
      imagePointer: "0x0000000000000000000000000000000000000000" as const, // set on-chain
      imageMime: processed.mimeId,
    };
    const imageHex = `0x${processed.bytes.toString("hex")}` as const;
    const args = [data.recipient as `0x${string}`, badge, imageHex] as const;

    const send = async () => {
      // Simulate first: surfaces contract reverts as readable errors before
      // spending any gas.
      const { request, result } = await publicClient.simulateContract({
        address: contract,
        abi: EXIT_BADGE_ABI,
        functionName: "mint",
        args,
        account,
      });

      const gas = await publicClient.estimateContractGas({
        address: contract, abi: EXIT_BADGE_ABI, functionName: "mint", args, account,
      });

      const nonce = await publicClient.getTransactionCount({
        address: account.address, blockTag: "pending",
      });

      const hash = await walletClient.writeContract({
        ...request,
        nonce,
        // Underestimation is the most common mint failure; 25% headroom.
        gas: (gas * 125n) / 100n,
      });
      return { hash, tokenId: result as bigint };
    };

    const { hash, tokenId } = await withNonceLock(async () => {
      try {
        return await send();
      } catch (err) {
        // A stale nonce is worth exactly one retry.
        if (isNonceError(err)) return await send();
        throw err;
      }
    });

    const explorerUrl = `${explorer}/tx/${hash}`;

    // The transaction is already broadcast at this point. If waiting for the
    // receipt times out, still return the hash — reporting a failure for a
    // transaction that is on its way would be actively misleading.
    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash, confirmations: 1, timeout: RECEIPT_TIMEOUT_MS,
      });
      return NextResponse.json<MintSuccess>({
        ok: true,
        tokenId: tokenId.toString(),
        txHash: hash,
        explorerUrl,
        status: receipt.status === "success" ? "confirmed" : "pending",
        imageBytes: processed.bytes.length,
        gasUsed: receipt.gasUsed.toString(),
      });
    } catch {
      return NextResponse.json<MintSuccess>({
        ok: true,
        tokenId: tokenId.toString(),
        txHash: hash,
        explorerUrl,
        status: "pending",
        imageBytes: processed.bytes.length,
      });
    }
  } catch (err) {
    if (err instanceof RelayerConfigError) {
      console.error("relayer misconfigured:", err.message);
      return fail("SERVER_MISCONFIGURED", "The minting service is not configured correctly.", 500);
    }
    const msg = String((err as Error)?.message ?? err);
    console.error("mint failed:", msg);

    if (msg.includes("insufficient funds")) {
      return fail("RELAYER_OUT_OF_GAS", "The minting wallet is out of gas. Please let the maintainer know.", 503);
    }
    // Surface contract custom errors, which carry the useful detail.
    for (const known of ["IllegalCharacter", "FieldTooLong", "ImageTooLarge", "InvalidRecipient", "UnknownMime"]) {
      if (msg.includes(known)) {
        return fail(known.toUpperCase(), `The badge was rejected by the contract (${known}).`);
      }
    }
    return fail("MINT_FAILED", "The mint transaction failed. Please try again.", 502);
  }
}
