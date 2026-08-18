import sharp from "sharp";
import type { Metadata } from "sharp";

/**
 * Squeeze an arbitrary user image into the on-chain byte budget.
 *
 * The badge shows the photo as a 400x400 panel inside a 600x800 card, so there
 * is no point storing anything larger. The real constraint is that the encoded
 * bytes are written into contract bytecode via SSTORE2, and EIP-170 caps that
 * at 24576 bytes.
 *
 * Strategy: encode at a good quality, and if the result overshoots, walk the
 * quality down and then the dimensions down until it fits. Quality degrades far
 * more gracefully than a hard rejection, and at 400x400 the difference between
 * q80 and q50 is barely perceptible.
 */

/** Contract-level ceiling (EIP-170 bound). Never exceed. */
export const HARD_MAX_BYTES = 24_000;
/** Policy target. Lower = cheaper mints. Adjustable without redeploying. */
export const TARGET_BYTES = 20_000;

// PNG is lossless, so "quality" only controls encoder effort, not file size —
// unlike WebP/JPEG there is no quality knob to trade against size. The only
// lever that reliably shrinks a PNG is resolution, so that ladder needs to
// reach further down for genuinely hard-to-compress images (fine texture,
// grain, noise) to still degrade gracefully instead of hard-failing.
const QUALITY_STEPS = [9]; // sharp's PNG compressionLevel; kept as a loop for symmetry with the size ladder
const SIZE_STEPS = [400, 340, 280, 220, 160, 120, 96, 64];

export class ImageProcessError extends Error {
  constructor(message: string, readonly code: "IMAGE_TOO_LARGE" | "IMAGE_INVALID") {
    super(message);
  }
}

export type ProcessedImage = {
  bytes: Buffer;
  /** Matches the contract's uint8 imageMime: 0=webp 1=png 2=jpeg */
  mimeId: 0 | 1 | 2;
  mime: string;
  width: number;
  quality: number;
};

/**
 * PNG, not WebP, despite WebP compressing meaningfully smaller at equal
 * quality. Verified directly: librsvg (which sharp uses to rasterize SVG, and
 * which is representative of how NFT tooling renders on-chain SVG metadata)
 * does not decode WebP embedded via <image href="data:image/webp;base64,...">
 * — the panel renders blank, silently, with no error. PNG in the identical
 * harness renders correctly. Found by minting a real badge and looking at the
 * rendered output, not by reasoning about format support in the abstract.
 */

/**
 * @param input raw bytes of the user's image (any format sharp understands)
 * @param budget maximum encoded size in bytes
 */
export async function processImage(input: Buffer, budget = TARGET_BYTES): Promise<ProcessedImage> {
  if (budget > HARD_MAX_BYTES) budget = HARD_MAX_BYTES;

  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new ImageProcessError("That file is not an image I can read.", "IMAGE_INVALID");
  }
  if (!meta.width || !meta.height) {
    throw new ImageProcessError("That image has no readable dimensions.", "IMAGE_INVALID");
  }

  for (const width of SIZE_STEPS) {
    for (const quality of QUALITY_STEPS) {
      const bytes = await sharp(input)
        .rotate() // honour EXIF orientation, else phone photos arrive sideways
        .resize(width, width, {
          fit: "cover",          // fill the square, never distort
          position: "attention", // crop toward the most salient region
        })
        .png({ compressionLevel: quality, effort: 10 })
        .toBuffer();

      if (bytes.length <= budget) {
        return { bytes, mimeId: 1, mime: "image/png", width, quality };
      }
    }
  }

  // Everything failed: the image is pathological (enormous noise, no
  // compressible structure). Better a clear message than a chain revert.
  throw new ImageProcessError(
    `That image cannot be compressed under ${(budget / 1024).toFixed(0)}KB. Try a simpler or smaller picture.`,
    "IMAGE_TOO_LARGE",
  );
}

/** Parse a browser-produced data URI back into bytes. */
export function decodeDataUri(uri: string): Buffer {
  const m = uri.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
  if (!m) throw new ImageProcessError("That uploaded image is malformed.", "IMAGE_INVALID");
  return Buffer.from(m[1], "base64");
}
