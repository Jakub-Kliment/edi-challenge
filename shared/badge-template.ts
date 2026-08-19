/**
 * SINGLE SOURCE OF TRUTH for the badge SVG.
 *
 * Both the on-chain renderer (contracts/ExitBadge.sol, generated from this
 * file) and the browser live-preview derive from here. Keeping one definition
 * is what stops the preview and the minted badge drifting apart — a drift
 * test in test/ExitBadge.test.ts asserts they produce byte-identical output.
 *
 * Design: vaporwave / retro-futurism. Sunset gradient sky, a setting sun
 * behind the photo panel, a receding perspective grid floor, chrome-style
 * display type. A deliberate departure from both the neon-cyberpunk sample in
 * the brief and the Swiss-minimal version this project shipped with earlier —
 * a real, distinct aesthetic rather than a palette swap.
 *
 * Everything here is standard SVG primitives (gradients, shapes, paths) —
 * no embedded fonts, no filters that depend on a specific rasterizer. The
 * on-chain image field IS embedded raster bytes, baked in as a data URI
 * (WebP doesn't decode inside an SVG <image> element in common rasterizers,
 * so the pipeline encodes JPEG instead) — that part of the composition is
 * unrelated to this redesign and unchanged.
 */

export const CANVAS = { width: 600, height: 800 } as const;

export const PALETTE = {
  skyTop: "#2b1055",
  skyMid: "#7c1f6e",
  skyBottom: "#ff6b6b",
  sunCore: "#ffd66b",
  sunEdge: "#ff5f9e",
  grid: "#20e3c2",
  gridDim: "#0f3d52",
  panel: "#1a0b33",
  text: "#fdf4ff",
  chrome1: "#ff8bd6",
  chrome2: "#7ee8ff",
  muted: "#c9a8e0",
  hairline: "#4a2a6b",
} as const;

export const IMAGE_FRAME = { x: 100, y: 148, size: 400 } as const;

export type BadgeData = {
  firstName: string;
  lastName: string;
  mainProject: string;
  startDate: string;       // YYYY-MM-DD
  completionDate: string;  // YYYY-MM-DD
  details: string;
  imageDataUri: string;    // data:image/png;base64,... (embedded, never remote)
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

/** Perspective grid floor: horizontal rungs closing toward a vanishing point,
 *  plus radiating verticals. Pure geometry, computed once. */
function gridFloor(): string {
  const vpX = 300, vpY = 706, floorY = 800;
  const lines: string[] = [];
  // Horizontal rungs, spaced to feel like they recede (denser near horizon).
  // Opacity values are precomputed to 2 clean decimals (not derived at
  // render time) so both this TS implementation and the Solidity mirror can
  // use the identical short literal — matching a full-precision JS float in
  // fixed-point Solidity would be needless fragility for a cosmetic value.
  const rungs: Array<[number, string]> = [
    [712, "0.15"], [718, "0.18"], [726, "0.23"],
    [738, "0.30"], [754, "0.39"], [776, "0.51"], [800, "0.65"],
  ];
  for (const [y, opacity] of rungs) {
    lines.push(`<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="${PALETTE.grid}" stroke-width="1" opacity="${opacity}"/>`);
  }
  // Radiating verticals toward the vanishing point.
  for (let x = -300; x <= 900; x += 60) {
    lines.push(`<line x1="${x}" y1="${floorY}" x2="${vpX}" y2="${vpY}" stroke="${PALETTE.grid}" stroke-width="1" opacity="0.35"/>`);
  }
  return lines.join("");
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
  const detailLines = wrapDetails(sanitize(data.details), 42, 2);

  const detailSvg = detailLines
    .slice(0, 2)
    .map((l, i) => `<text x="60" y="${690 + i * 20}" fill="${PALETTE.muted}" font-family="Menlo,Consolas,monospace" font-size="14">${l}</text>`)
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">`,
    `<defs>`,
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${PALETTE.skyTop}"/>`,
    `<stop offset="0.55" stop-color="${PALETTE.skyMid}"/>`,
    `<stop offset="1" stop-color="${PALETTE.skyBottom}"/>`,
    `</linearGradient>`,
    `<radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">`,
    `<stop offset="0" stop-color="${PALETTE.sunCore}"/>`,
    `<stop offset="1" stop-color="${PALETTE.sunEdge}"/>`,
    `</radialGradient>`,
    `<linearGradient id="chrome" x1="0" y1="0" x2="1" y2="0">`,
    `<stop offset="0" stop-color="${PALETTE.chrome1}"/>`,
    `<stop offset="1" stop-color="${PALETTE.chrome2}"/>`,
    `</linearGradient>`,
    `<clipPath id="floorClip"><rect x="0" y="712" width="600" height="88"/></clipPath>`,
    `</defs>`,
    `<rect width="600" height="800" fill="url(#sky)"/>`,
    `<circle cx="300" cy="120" r="155" fill="url(#sun)" opacity="0.92"/>`,
    `<g clip-path="url(#floorClip)">`,
    `<rect x="0" y="712" width="600" height="88" fill="${PALETTE.gridDim}"/>`,
    gridFloor(),
    `</g>`,
    `<rect x="0" y="0" width="600" height="6" fill="url(#chrome)"/>`,
    `<rect x="0" y="6" width="600" height="46" fill="${PALETTE.skyTop}" opacity="0.55"/>`,
    `<text x="60" y="36" fill="${PALETTE.text}" font-family="Arial Black,Helvetica,sans-serif" font-weight="900" font-size="15" letter-spacing="6">COMPLETION BADGE</text>`,
    `<rect x="${IMAGE_FRAME.x - 6}" y="${IMAGE_FRAME.y - 6}" width="${IMAGE_FRAME.size + 12}" height="${IMAGE_FRAME.size + 12}" fill="none" stroke="url(#chrome)" stroke-width="3"/>`,
    `<rect x="${IMAGE_FRAME.x - 2}" y="${IMAGE_FRAME.y - 2}" width="${IMAGE_FRAME.size + 4}" height="${IMAGE_FRAME.size + 4}" fill="${PALETTE.panel}"/>`,
    `<image x="${IMAGE_FRAME.x}" y="${IMAGE_FRAME.y}" width="${IMAGE_FRAME.size}" height="${IMAGE_FRAME.size}" preserveAspectRatio="xMidYMid slice" href="`,
    data.imageDataUri,
    `"/>`,
    `<text x="60" y="615" fill="url(#chrome)" font-family="Arial Black,Helvetica,sans-serif" font-weight="900" font-size="40" letter-spacing="1">${first} ${last}</text>`,
    `<text x="60" y="646" fill="${PALETTE.sunCore}" font-family="Menlo,Consolas,monospace" font-size="17" letter-spacing="2">${project}</text>`,
    `<text x="60" y="676" fill="${PALETTE.muted}" font-family="Menlo,Consolas,monospace" font-size="14">${start} :: ${end}</text>`,
    detailSvg,
    `</svg>`,
  ].join("");
}
