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

const QUALITY_STEPS = [80, 70, 60, 50, 40, 30];
const SIZE_STEPS = [400, 340, 280, 220];

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
        .webp({ quality, effort: 6 })
        .toBuffer();

      if (bytes.length <= budget) {
        return { bytes, mimeId: 0, mime: "image/webp", width, quality };
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
