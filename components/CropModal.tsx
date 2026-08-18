"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { processCroppedArea, type ClientImage } from "@/lib/image-client";

/**
 * Lets the user choose where the square crop lands on their uploaded image,
 * rather than always taking an automatic centre-crop. A centre-crop on a
 * portrait photo can cut off the subject's head — this is what "manage
 * cropping" in the bonus spec is actually asking for.
 */
export function CropModal({
  imageSrc, onDone, onCancel,
}: {
  imageSrc: string;
  onDone: (img: ClientImage) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setArea(croppedAreaPixels);
  }, []);

  async function confirm() {
    if (!area) return;
    setBusy(true);
    setError(undefined);
    try {
      // A defensive timeout: image decoding hangs are rare but silent, and a
      // spinner that never resolves is worse than an error the user can act on.
      const result = await Promise.race([
        processCroppedArea(imageSrc, area),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Cropping took too long. Try a smaller image.")), 15_000)),
      ]);
      onDone(result);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="crop-overlay">
      <div className="crop-panel">
        <div className="crop-stage">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="rect"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>
        <div className="crop-controls">
          <label className="crop-zoom-label">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <div className="crop-actions">
            <button type="button" className="chip" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="mint" style={{ padding: "8px 20px" }} onClick={confirm} disabled={busy || !area}>
              {busy ? "Processing…" : "Use this crop"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
