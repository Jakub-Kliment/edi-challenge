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
// JPEG's quality argument genuinely trades against size in canvas.toBlob
// (unlike PNG, where it is ignored), so most images fit at full 400px just by
// stepping quality down. Mirrors lib/image-server.ts — see the comment there
// for why JPEG and not WebP/PNG.
const SIZES = [400, 340, 280, 220, 160];
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

export type ClientImage = { dataUri: string; bytes: number; width: number; quality: number };


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

const IMAGE_TYPE = "image/jpeg";

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

/**
 * Crop a source image to the user-chosen rectangle (from react-easy-crop),
 * then run it through the same encode-under-budget loop as everything else.
 *
 * This is what Bonus A actually asks for: the automatic cover-fit crop in
 * processFile()/processUrl() picks a sensible default, but "manage the
 * functions of autoscaling, cropping etc." implies the user gets to choose
 * where the crop lands — a centre-crop can decapitate a portrait photo.
 */
export async function processCroppedArea(
  imageSrc: string,
  area: { x: number; y: number; width: number; height: number },
  budget = CLIENT_TARGET_BYTES,
): Promise<ClientImage> {
  // No crossOrigin here: imageSrc is always a data: URI at this call site
  // (from FileReader in ImageInput), never a remote URL, so there is no
  // cross-origin request to authorize. Setting crossOrigin on a data: URI
  // <img> is a known source of silent hangs in some engines.
  const img = await load(imageSrc);
  // Draw only the selected rectangle into a fresh canvas at output resolution,
  // then hand it to the same size/quality ladder every other path uses.
  const source = document.createElement("canvas");
  source.width = area.width;
  source.height = area.height;
  const sctx = source.getContext("2d")!;
  sctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

  // encodeUnderBudget expects an <img>-like source it can re-draw with
  // cover-fit; since the crop is already the exact square the user chose,
  // wrap it back into an Image so the existing ladder can resize it down.
  const croppedDataUri = source.toDataURL("image/png");
  const croppedImg = await load(croppedDataUri);
  return encodeUnderBudget(croppedImg, budget);
}
