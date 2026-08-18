"use client";

/**
 * Saved recipients, kept in localStorage.
 *
 * This exists because I got tired of re-pasting the same 42-character address
 * on every test mint. Nothing leaves the browser — no account, no backend,
 * which also means nothing to secure and nothing to explain in a privacy note.
 */

export type SavedRecipient = {
  id: string;
  nickname: string;
  address: string;
  addedAt: number;
};

const KEY = "elca-badge-address-book/v1";

/** Pre-seeded so the feature is useful on first load rather than empty. */
const SEED: SavedRecipient[] = [
  {
    id: "elca-examiner",
    nickname: "ELCA Examiner (Rafa)",
    address: "0x0c4869fd5A92ed96Aef6EFAeFCfdC1BEe931B67F",
    addedAt: 0,
  },
];

function read(): SavedRecipient[] {
  if (typeof window === "undefined") return SEED;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return SEED;
    return parsed.filter(
      (e): e is SavedRecipient =>
        e && typeof e.nickname === "string" && /^0x[a-fA-F0-9]{40}$/.test(e.address ?? ""),
    );
  } catch {
    return SEED; // corrupt storage should not break the form
  }
}

function write(entries: SavedRecipient[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota or private-browsing failures are not worth interrupting a mint over.
  }
}

export const addressBook = {
  list(): SavedRecipient[] {
    return read().sort((a, b) => a.addedAt - b.addedAt);
  },

  save(nickname: string, address: string): SavedRecipient[] {
    const entries = read();
    const clean = nickname.trim().slice(0, 40) || "Unnamed";
    const existing = entries.findIndex(
      (e) => e.address.toLowerCase() === address.toLowerCase(),
    );
    if (existing >= 0) {
      entries[existing] = { ...entries[existing], nickname: clean };
    } else {
      entries.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nickname: clean,
        address,
        addedAt: Date.now(),
      });
    }
    write(entries);
    return entries;
  },

  remove(id: string): SavedRecipient[] {
    const entries = read().filter((e) => e.id !== id);
    write(entries);
    return entries;
  },

  /** Match on nickname or address so either way of remembering works. */
  search(query: string): SavedRecipient[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    return this.list().filter(
      (e) => e.nickname.toLowerCase().includes(q) || e.address.toLowerCase().includes(q),
    );
  },
};

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
