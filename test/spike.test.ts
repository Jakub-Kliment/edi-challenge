import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

describe("M2 spike — SSTORE2 gas thesis", () => {
  it("stores a ~20KB blob and reports real gas", async () => {
    const { viem } = await network.getOrCreate();
    const spike = await viem.deployContract("SpikeSSTORE2");
    const pub = await viem.getPublicClient();

    // Simulate a 20KB WebP. Random bytes = worst case for calldata
    // (every byte nonzero @ 16 gas); a real WebP would be no worse.
    const SIZE = 20 * 1024;
    const blob = new Uint8Array(SIZE);
    for (let i = 0; i < SIZE; i++) blob[i] = 1 + (i % 254);
    const hex = ("0x" + Buffer.from(blob).toString("hex")) as `0x${string}`;

    const gas = await pub.estimateContractGas({
      address: spike.address,
      abi: spike.abi,
      functionName: "store",
      args: [hex],
    });

    const txHash = await spike.write.store([hex]);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });

    console.log(`\n  === M2 SPIKE RESULTS (${SIZE} bytes / ${(SIZE/1024).toFixed(0)}KB) ===`);
    console.log(`  estimated gas : ${gas.toLocaleString()}`);
    console.log(`  ACTUAL gas    : ${receipt.gasUsed.toLocaleString()}`);
    console.log(`  predicted     : ~4,581,770 (from the SSTORE2 model)`);
    console.log(`  naive SSTORE  : ~19,310,312 (the model I started with)`);
    const pctBlock = (Number(receipt.gasUsed) / 45_000_000) * 100;
    console.log(`  % of 45M block: ${pctBlock.toFixed(1)}%`);
    const vsNaive = 19_310_312 / Number(receipt.gasUsed);
    console.log(`  saving vs naive: ${vsNaive.toFixed(2)}x`);

    // Round-trip integrity — the whole thesis fails if bytes come back wrong.
    const raw = await spike.read.readRaw();
    assert.equal((raw as string).length, 2 + SIZE * 2, "raw byte length must round-trip");
    assert.equal(raw, hex, "bytes must be returned EXACTLY as stored");

    // The free-base64-in-a-view claim.
    const dataUri = await spike.read.readAsDataUri();
    assert.ok((dataUri as string).startsWith("data:image/webp;base64,"));
    const b64 = (dataUri as string).slice("data:image/webp;base64,".length);
    assert.equal(Buffer.from(b64, "base64").length, SIZE, "base64 must decode to original size");
    console.log(`  view fn base64: OK (${b64.length} chars, decodes to ${SIZE} bytes)`);

    // Full metadata shape.
    const uri = await spike.read.fullTokenURI();
    assert.ok((uri as string).startsWith("data:application/json;base64,"));
    const json = JSON.parse(
      Buffer.from((uri as string).slice("data:application/json;base64,".length), "base64").toString()
    );
    assert.ok(json.image.startsWith("data:image/svg+xml;base64,"));
    const svg = Buffer.from(json.image.slice("data:image/svg+xml;base64,".length), "base64").toString();
    assert.ok(svg.includes("<svg"), "must be an SVG");
    assert.ok(svg.includes("data:image/webp;base64,"), "image must be EMBEDDED, not referenced");
    assert.ok(!svg.includes('href="http'), "must contain NO external references");
    console.log(`  tokenURI      : OK (${(uri as string).length} chars total)`);
    console.log(`  SVG self-contained (no external refs): OK`);
    console.log("");
  });

  it("rejects blobs over the EIP-170-derived cap", async () => {
    const { viem } = await network.getOrCreate();
    const spike = await viem.deployContract("SpikeSSTORE2");
    const tooBig = ("0x" + "ab".repeat(24_001)) as `0x${string}`;
    await assert.rejects(async () => spike.write.store([tooBig]), /ImageTooLarge|revert/i);
    console.log("  oversize blob correctly rejected with a clear error\n");
  });
});
