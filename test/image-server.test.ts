import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { processImage, decodeDataUri, TARGET_BYTES, HARD_MAX_BYTES } from "../lib/image-server.js";

const makeImage = (w: number, h: number, noisy = false) => {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) {
    px[i] = noisy ? Math.floor(Math.random() * 256) : (i % 97) * 2;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
};

describe("image pipeline", () => {
  it("brings a large photo under the byte budget", async () => {
    const out = await processImage(await makeImage(2400, 1600));
    assert.ok(out.bytes.length <= TARGET_BYTES, `got ${out.bytes.length}`);
    // PNG, not WebP: librsvg does not decode WebP embedded in an SVG <image>
    // element (verified by minting and rendering a real badge — D22 in
    // DECISIONS.md), so the badge's photo panel would be silently blank in
    // any SVG-based renderer despite the bytes being stored correctly.
    assert.equal(out.mimeId, 1);
    assert.equal(out.mime, "image/png");
    console.log(`\n  2400x1600 -> ${out.width}px q${out.quality}, ${out.bytes.length} bytes`);
  });

  it("produces a square from any aspect ratio, without distortion", async () => {
    for (const [w, h] of [[3000, 500], [500, 3000], [1000, 1000]]) {
      const out = await processImage(await makeImage(w, h));
      const meta = await sharp(out.bytes).metadata();
      assert.equal(meta.width, meta.height, `${w}x${h} must yield a square`);
      assert.ok(out.bytes.length <= TARGET_BYTES);
    }
  });

  it("degrades quality rather than failing on hard-to-compress images", async () => {
    // Random noise is close to incompressible — the worst realistic case.
    const out = await processImage(await makeImage(1200, 1200, true));
    assert.ok(out.bytes.length <= TARGET_BYTES, `got ${out.bytes.length}`);
    console.log(`  noise 1200x1200 -> ${out.width}px q${out.quality}, ${out.bytes.length} bytes`);
  });

  it("respects a tighter budget when asked", async () => {
    const out = await processImage(await makeImage(1600, 1200), 8_000);
    assert.ok(out.bytes.length <= 8_000, `got ${out.bytes.length}`);
    console.log(`  8KB budget -> ${out.width}px q${out.quality}, ${out.bytes.length} bytes`);
  });

  it("never exceeds the contract's hard ceiling", async () => {
    const out = await processImage(await makeImage(4000, 3000), 999_999);
    assert.ok(out.bytes.length <= HARD_MAX_BYTES);
  });

  it("rejects files that are not images", async () => {
    await assert.rejects(
      async () => processImage(Buffer.from("this is definitely not an image")),
      /not an image/i
    );
  });

  it("decodes browser data URIs", async () => {
    const png = await makeImage(10, 10);
    const uri = "data:image/png;base64," + png.toString("base64");
    assert.ok(decodeDataUri(uri).equals(png));
    assert.throws(() => decodeDataUri("data:image/png,notbase64"), /malformed/);
  });
});
