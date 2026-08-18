/**
 * SINGLE SOURCE OF TRUTH for the badge SVG.
 *
 * Both the on-chain renderer (contracts/BadgeSVG.sol, generated from this file)
 * and the browser live-preview derive from here. Keeping one definition is what
 * stops the preview and the minted badge drifting apart — a drift test in
 * test/ExitBadge.test.ts asserts they produce byte-identical output.
 *
 * Design notes:
 * - 600x800 portrait, matching a physical badge/card proportion.
 * - Deep navy ground with an ELCA-red accent: a deliberate counterpoint to the
 *   neon-cyberpunk sample in the brief, and closer to how a Swiss engineering
 *   firm actually presents itself.
 * - The user's photo occupies a 400x400 panel; every other pixel is generated
 *   from the form data. That is what satisfies "generated from the input data,
 *   not a static file".
 */

export const CANVAS = { width: 600, height: 800 } as const;

export const PALETTE = {
  ground: "#0B1A2F",
  panel: "#122A47",
  accent: "#E2001A", // ELCA red
  text: "#F5F7FA",
  muted: "#8FA3BF",
  hairline: "#1E3A5F",
} as const;

export const IMAGE_FRAME = { x: 100, y: 132, size: 400 } as const;

export type BadgeData = {
  firstName: string;
  lastName: string;
  mainProject: string;
  startDate: string;       // YYYY-MM-DD
  completionDate: string;  // YYYY-MM-DD
  details: string;
  imageDataUri: string;    // data:image/webp;base64,... (embedded, never remote)
};

/** MIME lookup shared with the contract's uint8 imageMime field. */
export const MIME_BY_ID = ["image/webp", "image/png", "image/jpeg"] as const;

/**
 * Text that reaches the SVG must already be free of XML/JSON metacharacters.
 * We strip rather than escape, because the same stored string is interpolated
 * into BOTH an XML document and a JSON string, and no single escaping is
 * correct for both (&amp; is right for XML and wrong inside JSON).
 * The contract enforces the identical rule at mint time; this mirrors it so the
 * preview shows exactly what will be stored.
 */
export function sanitize(input: string): string {
  let out = "";
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f) continue;             // control chars
    if (ch === "<" || ch === ">" || ch === "&") continue;
    if (ch === '"' || ch === "\\") continue;
    out += ch;
  }
  return out;
}

export const FIELD_LIMITS = {
  firstName: 32,
  lastName: 32,
  mainProject: 64,
  startDate: 10,
  completionDate: 10,
  details: 200,
} as const;

/** Wrap `details` onto fixed-width lines so long text cannot overflow the card. */
export function wrapDetails(text: string, maxCharsPerLine = 42, maxLines = 3): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length > maxCharsPerLine) {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

/**
 * Build the badge SVG. MUST stay byte-identical to the Solidity implementation.
 * Kept as small, ordered chunks so the Solidity generator can mirror it exactly.
 */
export function buildSVG(data: BadgeData): string {
  const first = sanitize(data.firstName);
  const last = sanitize(data.lastName);
  const project = sanitize(data.mainProject);
  const start = sanitize(data.startDate);
  const end = sanitize(data.completionDate);
  const detailLines = wrapDetails(sanitize(data.details));

  const detailSvg = detailLines
    .map((l, i) => `<text x="60" y="${700 + i * 22}" fill="${PALETTE.muted}" font-family="Helvetica,Arial,sans-serif" font-size="16">${l}</text>`)
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">`,
    `<rect width="600" height="800" fill="${PALETTE.ground}"/>`,
    `<rect x="0" y="0" width="600" height="8" fill="${PALETTE.accent}"/>`,
    `<text x="60" y="70" fill="${PALETTE.text}" font-family="Helvetica,Arial,sans-serif" font-size="13" letter-spacing="3">COMPLETION BADGE</text>`,
    `<line x1="60" y1="96" x2="540" y2="96" stroke="${PALETTE.hairline}" stroke-width="1"/>`,
    `<rect x="${IMAGE_FRAME.x - 2}" y="${IMAGE_FRAME.y - 2}" width="${IMAGE_FRAME.size + 4}" height="${IMAGE_FRAME.size + 4}" fill="${PALETTE.panel}"/>`,
    `<image x="${IMAGE_FRAME.x}" y="${IMAGE_FRAME.y}" width="${IMAGE_FRAME.size}" height="${IMAGE_FRAME.size}" preserveAspectRatio="xMidYMid slice" href="`,
    data.imageDataUri,
    `"/>`,
    `<text x="60" y="600" fill="${PALETTE.text}" font-family="Helvetica,Arial,sans-serif" font-size="38" font-weight="bold">${first} ${last}</text>`,
    `<text x="60" y="634" fill="${PALETTE.accent}" font-family="Helvetica,Arial,sans-serif" font-size="18" letter-spacing="1">${project}</text>`,
    `<text x="60" y="666" fill="${PALETTE.muted}" font-family="Helvetica,Arial,sans-serif" font-size="15">${start} → ${end}</text>`,
    detailSvg,
    `<text x="60" y="770" fill="${PALETTE.hairline}" font-family="Helvetica,Arial,sans-serif" font-size="12" letter-spacing="2">POLYGON · ERC-721 · FULLY ON-CHAIN</text>`,
    `</svg>`,
  ].join("");
}
