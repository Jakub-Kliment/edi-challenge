"use client";

import { useMemo, useState, useDeferredValue } from "react";
import { BadgePreview } from "@/components/BadgePreview";
import { RecipientField } from "@/components/RecipientField";
import { ImageInput } from "@/components/ImageInput";
import type { ClientImage } from "@/lib/image-client";
import { FIELD_LIMITS, type BadgeData } from "@/shared/badge-template";
import type { MintFailure, MintSuccess } from "@/shared/schema";

const PLACEHOLDER_IMAGE =
  // A neutral grey square, so the preview has sensible proportions before an
  // image is chosen rather than collapsing.
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#16334f"/><text x="200" y="205" fill="#4d6b8f" font-family="Helvetica" font-size="15" text-anchor="middle">your image here</text></svg>`,
  );

const today = () => new Date().toISOString().slice(0, 10);

// Reflects the actual state of the relayer, not just a feature flag: the
// mainnet contract has been deliberately left undeployed and unfunded (see
// DECISIONS.md) rather than spending real POL to complete a bonus feature.
// NEXT_PUBLIC_* vars are inlined by Next at build time, so this is safe to
// read directly.
const MAINNET_ENABLED = process.env.NEXT_PUBLIC_MAINNET_ENABLED === "true";

export default function Home() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    mainProject: "",
    startDate: today(),
    completionDate: today(),
    details: "",
    recipient: "",
  });
  const [image, setImage] = useState<ClientImage | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageChecked, setImageChecked] = useState(false);
  const [chain, setChain] = useState<"amoy" | "polygon">("amoy");
  const [minting, setMinting] = useState(false);
  const [result, setResult] = useState<MintSuccess | MintFailure | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Keeps typing responsive: the SVG rebuild lags the keystroke rather than
  // blocking it.
  const deferred = useDeferredValue(form);
  const deferredImage = useDeferredValue(image);
  const deferredUrl = useDeferredValue(imageUrl);

  const badgeData: BadgeData = useMemo(
    () => ({
      firstName: deferred.firstName || "First",
      lastName: deferred.lastName || "Last",
      mainProject: deferred.mainProject || "Project name",
      startDate: deferred.startDate,
      completionDate: deferred.completionDate,
      details: deferred.details || "",
      // Prefer locally-resized bytes. If CORS blocked that, fall back to the
      // raw URL so the preview still shows the real picture — the badge itself
      // always embeds bytes, this is preview-only.
      imageDataUri:
        deferredImage?.dataUri ??
        (/^https:\/\/.+/.test(deferredUrl) ? deferredUrl : PLACEHOLDER_IMAGE),
    }),
    [deferred, deferredImage],
  );

  // A URL alone is not enough: the browser may still be fetching it, or CORS
  // may have blocked local processing. Requiring either processed bytes or a
  // URL we have finished checking keeps the button honest about what will be
  // minted.
  const hasImage = Boolean(image) || (/^https:\/\/.+/.test(imageUrl) && imageChecked);
  const canMint =
    !minting &&
    (chain === "amoy" || MAINNET_ENABLED) &&
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.mainProject.trim() &&
    form.details.trim() &&
    /^0x[a-fA-F0-9]{40}$/.test(form.recipient) &&
    hasImage;

  async function mint() {
    setMinting(true);
    setResult(null);
    try {
      const res = await fetch("/api/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          chain,
          // Prefer the browser-resized bytes; fall back to letting the server
          // fetch the URL when CORS blocked local processing.
          ...(image ? { imageDataUri: image.dataUri } : { imageUrl }),
        }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, code: "NETWORK", message: "Could not reach the minting service." });
    } finally {
      setMinting(false);
    }
  }

  const counter = (k: keyof typeof FIELD_LIMITS) => {
    const used = (form as Record<string, string>)[k]?.length ?? 0;
    const max = FIELD_LIMITS[k];
    return <span className={`counter ${used > max ? "over" : ""}`}>{used}/{max}</span>;
  };

  return (
    <main className="shell">
      <div className="accent-rule" />
      <header className="masthead">
        <h1>On-chain completion badges</h1>
        <p>
          Fill in the details, and a badge is minted as an ERC-721 and sent to whichever wallet you
          choose. You do not need a wallet, an account, or any POL — the badge, including its
          artwork, is stored entirely on Polygon.
        </p>
      </header>

      <div className="netbar">
        <span className={`dot ${chain === "polygon" && !MAINNET_ENABLED ? "dot-warn" : ""}`} />
        <span>Network</span>
        <select value={chain} onChange={(e) => setChain(e.target.value as "amoy" | "polygon")}>
          <option value="amoy">Polygon Amoy (testnet)</option>
          <option value="polygon">Polygon (mainnet){MAINNET_ENABLED ? "" : " — not yet funded"}</option>
        </select>
        {chain === "polygon" && !MAINNET_ENABLED && (
          <span className="netbar-note">
            The mainnet contract exists in code but has not been deployed or funded with real POL.
            Minting will not work on this network yet — switch to Amoy to try the app.
          </span>
        )}
      </div>

      <div className="columns">
        <div>
          <section className="panel">
            <h2>Recipient</h2>
            <p className="hint">Who is this badge for?</p>
            <div className="row">
              <div className="field">
                <label htmlFor="firstName">First name {counter("firstName")}</label>
                <input id="firstName" value={form.firstName} maxLength={FIELD_LIMITS.firstName}
                  onChange={(e) => set("firstName")(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="lastName">Last name {counter("lastName")}</label>
                <input id="lastName" value={form.lastName} maxLength={FIELD_LIMITS.lastName}
                  onChange={(e) => set("lastName")(e.target.value)} />
              </div>
            </div>
            <RecipientField value={form.recipient} onChange={set("recipient")} />
          </section>

          <section className="panel">
            <h2>The work</h2>
            <p className="hint">What is being recognised.</p>
            <div className="field">
              <label htmlFor="mainProject">Main project {counter("mainProject")}</label>
              <input id="mainProject" value={form.mainProject} maxLength={FIELD_LIMITS.mainProject}
                onChange={(e) => set("mainProject")(e.target.value)} />
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="startDate">Start date</label>
                <input id="startDate" type="date" value={form.startDate}
                  onChange={(e) => set("startDate")(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="completionDate">Completion date</label>
                <input id="completionDate" type="date" value={form.completionDate}
                  onChange={(e) => set("completionDate")(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="details">Details {counter("details")}</label>
              <textarea id="details" value={form.details} maxLength={FIELD_LIMITS.details}
                placeholder="A sentence about what they did."
                onChange={(e) => set("details")(e.target.value)} />
            </div>
          </section>

          <section className="panel">
            <h2>Artwork</h2>
            <p className="hint">
              The picture sits inside the badge. Everything around it is drawn from the details above.
            </p>
            <ImageInput
              url={imageUrl}
              onImage={(img) => { setImage(img); setImageChecked(true); }}
              onUrl={(u) => {
                setImageUrl(u);
                if (!u) { setImage(null); setImageChecked(false); }
              }}
              bytes={image?.bytes ?? null}
            />
          </section>

          <section className="panel">
            <button className="mint" disabled={!canMint} onClick={mint}>
              {minting ? <><span className="spinner" />Minting…</> : "Mint and send badge"}
            </button>
            {!canMint && !minting && (
              <p className="hint" style={{ marginTop: 10, marginBottom: 0, textAlign: "center" }}>
                {chain === "polygon" && !MAINNET_ENABLED
                  ? "Mainnet is not funded yet — switch to Amoy to mint."
                  : "Fill in every field and choose an image to continue."}
              </p>
            )}

            {result && (
              <div className={`result ${result.ok ? "ok" : "bad"}`}>
                {result.ok ? (
                  <>
                    <h3>
                      {result.status === "confirmed"
                        ? "Badge minted and sent"
                        : "Badge submitted — confirming on-chain"}
                    </h3>
                    <dl>
                      <dt>Token</dt><dd>#{result.tokenId}</dd>
                      <dt>Image</dt><dd>{(result.imageBytes / 1024).toFixed(1)} KB on-chain</dd>
                      {result.gasUsed && (<><dt>Gas</dt><dd>{Number(result.gasUsed).toLocaleString()}</dd></>)}
                      <dt>Transaction</dt>
                      <dd><a href={result.explorerUrl} target="_blank" rel="noreferrer">View on PolygonScan ↗</a></dd>
                    </dl>
                  </>
                ) : (
                  <>
                    <h3>That did not work</h3>
                    <p style={{ margin: 0, fontSize: 13 }}>{result.message}</p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        <BadgePreview data={badgeData} />
      </div>
    </main>
  );
}
