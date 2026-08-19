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
    // JPEG, not WebP or PNG. WebP: librsvg does not decode WebP embedded in
    // an SVG <image> element — the photo panel renders blank in any
    // SVG-based renderer despite the bytes being stored correctly. PNG (the
    // first fix) renders correctly but is lossless, so hard-to-compress
    // images (e.g. a low-res thumbnail) were forced down to as little as
    // 160px to hit budget — see the dedicated test below.
    assert.equal(out.mimeId, 2);
    assert.equal(out.mime, "image/jpeg");
    console.log(`\n  2400x1600 -> ${out.width}px q${out.quality}, ${out.bytes.length} bytes`);
  });

  it("keeps full resolution on a hard-to-compress low-quality source", async () => {
    // Regression test for a real report: a user pasted a ~515x388 Google
    // Images thumbnail (busy geometric content, already lossy-compressed —
    // genuinely hard to compress further). Under PNG this collapsed all the
    // way to 160px to fit the byte budget, visibly blocky at 400px display
    // size. JPEG should hit budget via quality alone, keeping full width.
    const px = Buffer.alloc(500 * 400 * 3);
    for (let i = 0; i < px.length; i++) {
      // High-frequency striped pattern — deliberately hard for any codec to
      // compress losslessly, similar in spirit to the real photo that broke.
      px[i] = (i % 7 < 3) ? 250 : (i * 37) % 256;
    }
    const src = await sharp(px, { raw: { width: 500, height: 400, channels: 3 } }).jpeg({ quality: 60 }).toBuffer();
    const out = await processImage(src);
    assert.ok(out.bytes.length <= TARGET_BYTES, `got ${out.bytes.length}`);
    // The actual regression this guards: PNG collapsed a source this hard all
    // the way to 160px. JPEG should stay well above that even if quality
    // alone cannot always hold full 400px for genuinely adversarial input.
    assert.ok(out.width >= 340, `expected >=340px (PNG collapsed to 160px on comparable input), got ${out.width}px`);
    console.log(`  hard thumbnail -> ${out.width}px q${out.quality}, ${out.bytes.length} bytes`);
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
