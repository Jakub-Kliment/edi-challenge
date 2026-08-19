# On-chain Completion Badges

A public badge generator built for the ELCA EDI Challenge 2026. Anyone can fill
in a form, watch a live preview, and mint a fully on-chain ERC-721 "completion
badge" to any wallet address — no wallet connection, login, or gas required
from the user.

**Live app:** https://edi-badge-minter.vercel.app
**Contract (Polygon Amoy testnet):** `0xD86F34D8113D8275d52903D1fA012bC40c00Baa1`

## How it works

- The form takes first/last name, main project, start/completion date,
  details, an image (link or upload), and a recipient wallet address.
- The badge is an SVG built entirely from that input — gradients, layout,
  and text are generated, not a static template image. The same generator
  function (`shared/badge-template.ts`) drives both the live preview and the
  Solidity contract's on-chain renderer (`contracts/ExitBadge.sol`), verified
  byte-identical by a drift test.
- Minting goes through a relayer: a server-held wallet signs and pays gas, so
  the person using the app never needs POL or a connected wallet. Only the
  recipient needs an address.
- The badge image is resized, compressed to JPEG, and stored on-chain via
  SSTORE2 — no IPFS, no external image host. What you see is what's on-chain.

## Stack

Next.js (App Router) + TypeScript on the frontend, Solidity + Hardhat 3 for
the contract, `viem` for chain interaction, `sharp` for server-side image
processing. Deployed on Vercel.

## Running locally

```bash
npm install
cp .env.example .env   # fill in an RPC URL and a funded relayer private key
npm run dev
```

Other useful scripts:

```bash
npm test                 # Hardhat + Node test suite, incl. the SVG drift guard
npm run compile           # compile the contract
npm run deploy:amoy       # deploy ExitBadge to Polygon Amoy
npm run gen:abi           # regenerate lib/abi.ts from the compiled artifact
```

## Notable decisions

- **JPEG, not PNG or WebP, for the embedded image.** WebP doesn't decode
  inside an SVG `<image>` element in common rasterizers (renders blank).
  PNG is lossless with no quality lever, so hard-to-compress sources were
  forced down to a tiny resolution to fit the on-chain size budget. JPEG's
  quality/size tradeoff keeps full resolution on those images.
- **SSRF-safe image fetching.** The mint endpoint accepts an arbitrary URL
  from anonymous users, so it resolves and validates the target IP, refuses
  to follow redirects (which could otherwise smuggle a request to a private
  address past the check), and sniffs the real file type from magic bytes
  rather than trusting the `Content-Type` header.
- **Pure-CSS tilt effect** on the live preview — no pointer-tracking JS, so
  there's no event stream to desync or get stuck.
