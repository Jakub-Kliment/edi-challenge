"use client";

import { useRef, useState } from "react";
import { processUrl, type ClientImage } from "@/lib/image-client";
import { CropModal } from "@/components/CropModal";

/**
 * Image source: a link, or a file the user picks.
 *
 * Both resolve to the same thing — a resized data URI ready for the preview and
 * small enough to upload. A remote URL is resized here when CORS allows it, and
 * otherwise handed to the server, which has no such restriction.
 */
export function ImageInput({
  url, onImage, onUrl, bytes, error,
}: {
  /** Owned by the parent. Keeping a second copy in local state let the two
   *  disagree after a parent re-render — the field showed a URL while the
   *  preview showed the placeholder. */
  url: string;
  onImage: (img: ClientImage | null) => void;
  onUrl: (url: string) => void;
  bytes: number | null;
  error?: string;
}) {
  const [mode, setMode] = useState<"link" | "upload">("link");
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const [cropSrc, setCropSrc] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUrl = async (value: string) => {
    onUrl(value);
    setLocalError(undefined);
    if (!/^https:\/\/.+/.test(value)) { onImage(null); return; }
    setBusy(true);
    const result = await processUrl(value);
    onImage(result);
    // A browser <img> load failure does not say WHY — CORS blocking and a
    // genuinely dead/non-image link raise the identical generic error, by
    // design (browsers do not leak that information to page script). So this
    // cannot reliably tell "harmless CORS" from "this link is actually bad"
    // client-side. Rather than staying silent either way (which left a user
    // pasting a broken link with no signal until they pressed Mint and hit a
    // server round-trip), show a neutral heads-up so they are not confused by
    // an unexplained blank preview — the server is still the final check.
    if (result === null) {
      setLocalError("Could not preview this image locally — it may still work when you mint, or the link may not point to an image.");
    }
    setBusy(false);
  };

  /**
   * Uploaded files go through the crop modal (Bonus A: the user chooses
   * where the square lands, rather than an automatic centre-crop). Pasted
   * links skip it — asking someone to crop a photo they don't control the
   * source of is unnecessary friction, and processUrl()'s automatic
   * attention-weighted crop (server-side) already handles arbitrary
   * aspect ratios reasonably.
   */
  const handleFile = (file: File) => {
    setLocalError(undefined);
    const reader = new FileReader();
    reader.onload = () => setCropSrc(reader.result as string);
    reader.onerror = () => setLocalError("Could not read that file.");
    reader.readAsDataURL(file);
  };

  const handleCropDone = (img: ClientImage) => {
    // Deliberately does NOT call onUrl("") — the parent treats an empty URL
    // as "clear the image" (see app/page.tsx), so calling both onImage and
    // onUrl in the same tick let the URL clear race the image set and silently
    // wipe it out. Upload mode never touches the URL field in the first
    // place, so there is nothing to clear here.
    onImage(img);
    setCropSrc(undefined);
  };

  return (
    <div className="field">
      <label>Badge image</label>
      <div className="tabs">
        <button type="button" className={`tab ${mode === "link" ? "on" : ""}`} onClick={() => setMode("link")}>
          Paste a link
        </button>
        <button type="button" className={`tab ${mode === "upload" ? "on" : ""}`} onClick={() => setMode("upload")}>
          Upload a file
        </button>
      </div>

      {mode === "link" ? (
        <input
          className="mono"
          placeholder="https://example.com/photo.jpg"
          value={url}
          onChange={(e) => handleUrl(e.target.value)}
        />
      ) : (
        <>
          <div
            className={`dropzone ${hot ? "hot" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setHot(true); }}
            onDragLeave={() => setHot(false)}
            onDrop={(e) => {
              e.preventDefault(); setHot(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            {busy ? "Processing…" : "Drop an image here, or click to choose"}
            <div style={{ fontSize: 11, marginTop: 6, opacity: .7 }}>
              Any size or shape — it gets cropped square and shrunk to fit on-chain
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </>
      )}

      {(localError || error) && <div className="error">{localError ?? error}</div>}

      {bytes !== null && (
        <div className="imgstat">
          <span>on-chain size</span>
          <span className={bytes <= 20000 ? "good" : ""}>
            {(bytes / 1024).toFixed(1)} KB / 20 KB
          </span>
        </div>
      )}
      {busy && mode === "link" && <div className="imgstat"><span>checking image…</span></div>}

      {cropSrc && (
        <CropModal
          imageSrc={cropSrc}
          onDone={handleCropDone}
          onCancel={() => setCropSrc(undefined)}
        />
      )}
    </div>
  );
}
