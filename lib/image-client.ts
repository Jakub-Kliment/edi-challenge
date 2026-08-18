"use client";

/**
 * Browser-side resize.
 *
 * Two reasons to do this here as well as on the server: the preview needs the
 * bytes immediately, and shrinking before upload keeps the request small. The
 * server re-encodes regardless — the client is never trusted, this is purely
 * for responsiveness.
 */

export const CLIENT_TARGET_BYTES = 20_000;
// PNG (see comment on IMAGE_TYPE) is lossless: canvas.toBlob's quality
// argument is ignored for image/png, so QUALITIES below is a no-op loop kept
// only so the retry structure matches the server. Resolution is the only real
// lever, hence the ladder reaching further down than it would for a lossy
// format.
const SIZES = [400, 340, 280, 220, 160, 120, 96, 64];
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

export type ClientImage = { dataUri: string; bytes: number; width: number; quality: number };

/** PNG, matching the server: librsvg does not render embedded WebP <image>
 *  elements, so the badge's image panel would be blank in any SVG rasterizer.
 *  See lib/image-server.ts for the full explanation. */

function drawCover(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Cover-fit: scale to fill, centre-crop the overflow. Never stretch.
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas;
}

const IMAGE_TYPE = "image/png";

const toBlob = (canvas: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));

async function encodeUnderBudget(img: HTMLImageElement, budget: number): Promise<ClientImage> {
  for (const size of SIZES) {
    const canvas = drawCover(img, size);
    for (const quality of QUALITIES) {
      const blob = await toBlob(canvas, IMAGE_TYPE, quality);
      if (blob && blob.size <= budget) {
        const dataUri = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.readAsDataURL(blob);
        });
        return { dataUri, bytes: blob.size, width: size, quality };
      }
    }
  }
  throw new Error("That image cannot be compressed small enough. Try a simpler picture.");
}

function load(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load that image."));
    img.src = src;
  });
}

/** Resize a file the user picked. */
export async function processFile(file: File, budget = CLIENT_TARGET_BYTES): Promise<ClientImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await encodeUnderBudget(await load(objectUrl), budget);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Try to resize a remote URL in the browser. Often blocked by CORS, in which
 * case the caller falls back to letting the server fetch it — the server has no
 * such restriction.
 */
export async function processUrl(url: string, budget = CLIENT_TARGET_BYTES): Promise<ClientImage | null> {
  try {
    return await encodeUnderBudget(await load(url, "anonymous"), budget);
  } catch {
    return null; // CORS or unreachable: server-side fetch will handle it
  }
}
