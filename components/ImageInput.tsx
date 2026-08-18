"use client";

import { useRef, useState } from "react";
import { processFile, processUrl, type ClientImage } from "@/lib/image-client";

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
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUrl = async (value: string) => {
    onUrl(value);
    setLocalError(undefined);
    if (!/^https:\/\/.+/.test(value)) { onImage(null); return; }
    setBusy(true);
    // May return null if CORS blocks canvas access — the server will fetch it.
    onImage(await processUrl(value));
    setBusy(false);
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setLocalError(undefined);
    try {
      onImage(await processFile(file));
      onUrl("");
    } catch (e) {
      setLocalError((e as Error).message);
      onImage(null);
    } finally {
      setBusy(false);
    }
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
    </div>
  );
}
