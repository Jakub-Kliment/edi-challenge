"use client";

import { useMemo, useState } from "react";

export type GalleryBadge = {
  tokenId: string;
  owner: `0x${string}`;
  name: string;
  imageDataUri: string;
  project: string;
  explorerUrl: string;
};

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function GalleryGrid({ badges }: { badges: GalleryBadge[] }) {
  const [addressFilter, setAddressFilter] = useState("");

  const filtered = useMemo(() => {
    const needle = addressFilter.trim().toLowerCase();
    if (!needle) return badges;
    return badges.filter((b) => b.owner.toLowerCase().includes(needle));
  }, [badges, addressFilter]);

  return (
    <>
      <div className="field gallery-filter">
        <label htmlFor="ownerFilter">Filter by address</label>
        <input
          id="ownerFilter"
          className="mono"
          placeholder="0x…"
          value={addressFilter}
          onChange={(e) => setAddressFilter(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="hint">No badges match that address.</p>
      ) : (
        <div className="gallery-grid">
          {filtered.map((badge) => (
            <a
              className="gallery-card"
              key={badge.tokenId}
              href={badge.explorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              <div className="gallery-card-frame">
                <img src={badge.imageDataUri} alt={badge.name} />
              </div>
              <div className="gallery-card-meta">
                <span className="gallery-card-title">{badge.name}</span>
                <span className="gallery-card-sub">{badge.project}</span>
                <span className="gallery-card-owner mono">#{badge.tokenId} · {short(badge.owner)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
