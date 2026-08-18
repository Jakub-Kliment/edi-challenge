"use client";

import { useEffect, useRef, useState } from "react";
import { addressBook, shortAddress, type SavedRecipient } from "@/lib/address-book";

/**
 * Recipient input with a saved-address dropdown.
 *
 * Built this after pasting the same 42-character address for the tenth time
 * while testing. Everything lives in localStorage — no account, nothing sent
 * anywhere.
 */
export function RecipientField({
  value, onChange, error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const [entries, setEntries] = useState<SavedRecipient[]>([]);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nickname, setNickname] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setEntries(addressBook.list()), []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const matches = addressBook.search(value).filter((e) =>
    value ? e.address.toLowerCase() !== value.toLowerCase() : true,
  );
  const isValid = /^0x[a-fA-F0-9]{40}$/.test(value);
  const alreadySaved = entries.some((e) => e.address.toLowerCase() === value.toLowerCase());

  return (
    <div className="field" ref={wrapRef}>
      <label htmlFor="recipient">Recipient wallet</label>
      <input
        id="recipient"
        className="mono"
        value={value}
        placeholder="0x… or start typing a saved name"
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {error && <div className="error">{error}</div>}

      {open && matches.length > 0 && (
        <div className="suggestions">
          {matches.map((e) => (
            <div key={e.id} className="suggestion">
              <button
                type="button"
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", background: "none", border: "none", color: "inherit", cursor: "pointer", flex: 1, padding: 0 }}
                onClick={() => { onChange(e.address); setOpen(false); }}
              >
                <span className="nick">{e.nickname}</span>
                <span className="addr">{shortAddress(e.address)}</span>
              </button>
              {e.id !== "elca-examiner" && (
                <button
                  type="button"
                  className="kill"
                  aria-label={`Remove ${e.nickname}`}
                  onClick={(ev) => { ev.stopPropagation(); setEntries(addressBook.remove(e.id)); }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isValid && !alreadySaved && !naming && (
        <div className="inline-actions">
          <button type="button" className="chip" onClick={() => setNaming(true)}>
            + Save this address
          </button>
        </div>
      )}

      {naming && (
        <div className="inline-actions">
          <input
            autoFocus
            placeholder="Nickname"
            value={nickname}
            style={{ flex: 1, padding: "6px 10px", background: "var(--ground)", border: "1px solid var(--hairline)", borderRadius: 6, color: "var(--text)", fontSize: 13 }}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setEntries(addressBook.save(nickname, value));
                setNaming(false); setNickname("");
              }
              if (e.key === "Escape") { setNaming(false); setNickname(""); }
            }}
          />
          <button
            type="button"
            className="chip"
            onClick={() => { setEntries(addressBook.save(nickname, value)); setNaming(false); setNickname(""); }}
          >
            Save
          </button>
          <button type="button" className="chip" onClick={() => { setNaming(false); setNickname(""); }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
