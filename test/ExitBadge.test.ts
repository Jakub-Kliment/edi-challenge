import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { buildSVG, sanitize, type BadgeData } from "../shared/badge-template.js";

/** Decode a data:application/json;base64 tokenURI into its parsed JSON. */
function decodeTokenURI(uri: string) {
  const prefix = "data:application/json;base64,";
  assert.ok(uri.startsWith(prefix), "tokenURI must be a base64 JSON data URI");
  const json = JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString());
  const imgPrefix = "data:image/svg+xml;base64,";
  assert.ok(json.image.startsWith(imgPrefix), "image must be a base64 SVG data URI");
  const svg = Buffer.from(json.image.slice(imgPrefix.length), "base64").toString();
  return { json, svg };
}

const IMG = (() => {
  // Stand-in for a compressed WebP. Content is irrelevant to these tests;
  // only size and exact round-tripping matter.
  const n = 2048;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = 1 + (i % 254);
  return ("0x" + Buffer.from(b).toString("hex")) as `0x${string}`;
})();

const BADGE = {
  firstName: "Jakub",
  lastName: "Kliment",
  mainProject: "EDI Challenge 2026",
  startDate: "2026-08-18",
  completionDate: "2026-08-18",
  details: "Built a fully on-chain badge minter on Polygon Amoy",
  imagePointer: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  imageMime: 0,
};

describe("ExitBadge", () => {
  let viem: any, owner: any, recipient: any;

  before(async () => {
    ({ viem } = await network.getOrCreate());
    const wallets = await viem.getWalletClients();
    owner = wallets[0];
    recipient = wallets[1];
  });

  const deploy = async () => viem.deployContract("ExitBadge", [owner.account.address]);

  it("mints to the recipient and reports gas", async () => {
    const c = await deploy();
    const pub = await viem.getPublicClient();
    const hash = await c.write.mint([recipient.account.address, BADGE, IMG]);
    const receipt = await pub.waitForTransactionReceipt({ hash });

    assert.equal(
      (await c.read.ownerOf([1n]) as string).toLowerCase(),
      recipient.account.address.toLowerCase()
    );
    assert.equal(await c.read.totalMinted(), 1n);
    console.log(`\n  mint gas (2KB image): ${receipt.gasUsed.toLocaleString()}`);
  });

  it("produces valid ERC-721 metadata with an embedded, self-contained SVG", async () => {
    const c = await deploy();
    await c.write.mint([recipient.account.address, BADGE, IMG]);
    const { json, svg } = decodeTokenURI(await c.read.tokenURI([1n]));

    assert.equal(json.name, "Jakub Kliment - EDI Challenge 2026");
    assert.ok(Array.isArray(json.attributes) && json.attributes.length === 5);

    // The whole architecture in three assertions:
    assert.ok(svg.startsWith("<svg"), "must be an SVG");
    assert.ok(svg.includes("data:image/webp;base64,"), "image must be EMBEDDED");
    assert.ok(!/href="https?:/.test(svg), "must contain NO external references");
  });

  it("matches the TypeScript template byte for byte (drift guard)", async () => {
    // The highest-value test here. The live preview is rendered in the browser
    // from shared/badge-template.ts; the badge is rendered on-chain by Solidity.
    // If those two ever disagree, users are shown something they will not get.
    const c = await deploy();
    await c.write.mint([recipient.account.address, BADGE, IMG]);
    const { svg: onChain } = decodeTokenURI(await c.read.tokenURI([1n]));

    const data: BadgeData = {
      ...BADGE,
      imageDataUri: "data:image/webp;base64," + Buffer.from(IMG.slice(2), "hex").toString("base64"),
    };
    const offChain = buildSVG(data);

    if (onChain !== offChain) {
      for (let i = 0; i < Math.max(onChain.length, offChain.length); i++) {
        if (onChain[i] !== offChain[i]) {
          console.log(`\n  first divergence at char ${i}`);
          console.log(`  on-chain : ...${onChain.slice(Math.max(0, i - 40), i + 40)}...`);
          console.log(`  template : ...${offChain.slice(Math.max(0, i - 40), i + 40)}...`);
          break;
        }
      }
    }
    assert.equal(onChain, offChain, "on-chain SVG must equal the shared template output");
  });

  it("rejects XML and JSON metacharacters in every text field", async () => {
    const c = await deploy();
    const nasty = ['<script>', 'a"b', "x&y", "back\\slash", ">gt"];
    const fields = ["firstName", "lastName", "mainProject", "details"] as const;
    for (const f of fields) {
      for (const bad of nasty) {
        await assert.rejects(
          async () => c.write.mint([recipient.account.address, { ...BADGE, [f]: bad }, IMG]),
          /IllegalCharacter/,
          `field ${f} must reject ${JSON.stringify(bad)}`
        );
      }
    }
  });

  it("keeps metadata parseable when text is at the edge of what is allowed", async () => {
    const c = await deploy();
    // Apostrophes and slashes are legal in both XML text and JSON strings.
    const tricky = { ...BADGE, firstName: "O'Brien", lastName: "Smith-Jones", mainProject: "R/D Team (2026)" };
    await c.write.mint([recipient.account.address, tricky, IMG]);
    const { json, svg } = decodeTokenURI(await c.read.tokenURI([1n]));
    assert.ok(json.name.includes("O'Brien"));
    assert.ok(svg.includes("O'Brien"));
  });

  it("enforces field length limits", async () => {
    const c = await deploy();
    await assert.rejects(
      async () => c.write.mint([recipient.account.address, { ...BADGE, firstName: "x".repeat(33) }, IMG]),
      /FieldTooLong/
    );
    await assert.rejects(
      async () => c.write.mint([recipient.account.address, { ...BADGE, details: "x".repeat(201) }, IMG]),
      /FieldTooLong/
    );
  });

  it("enforces image size bounds", async () => {
    const c = await deploy();
    await assert.rejects(
      async () => c.write.mint([recipient.account.address, BADGE, "0x"]),
      /ImageEmpty/
    );
    const tooBig = ("0x" + "ab".repeat(24_001)) as `0x${string}`;
    await assert.rejects(
      async () => c.write.mint([recipient.account.address, BADGE, tooBig]),
      /ImageTooLarge/
    );
  });

  it("stores images at the boundary and returns them intact", async () => {
    const c = await deploy();
    const n = 24_000;
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = 1 + (i % 254);
    const hex = ("0x" + Buffer.from(b).toString("hex")) as `0x${string}`;
    await c.write.mint([recipient.account.address, BADGE, hex]);

    const { svg } = decodeTokenURI(await c.read.tokenURI([1n]));
    const m = svg.match(/href="data:image\/webp;base64,([^"]+)"/);
    assert.ok(m, "embedded image must be present");
    assert.equal(Buffer.from(m![1], "base64").length, n, "image must round-trip at full size");
  });

  it("rejects the zero address and unknown MIME ids", async () => {
    const c = await deploy();
    await assert.rejects(
      async () => c.write.mint(["0x0000000000000000000000000000000000000000", BADGE, IMG]),
      /InvalidRecipient/
    );
    await assert.rejects(
      async () => c.write.mint([recipient.account.address, { ...BADGE, imageMime: 3 }, IMG]),
      /UnknownMime/
    );
  });

  it("restricts minting to the owner (the relayer)", async () => {
    const c = await deploy();
    const asStranger = await viem.getContractAt("ExitBadge", c.address, { client: { wallet: recipient } });
    await assert.rejects(
      async () => asStranger.write.mint([recipient.account.address, BADGE, IMG]),
      /OwnableUnauthorizedAccount/
    );
  });

  it("reverts for tokens that do not exist", async () => {
    const c = await deploy();
    await assert.rejects(async () => c.read.tokenURI([99n]), /NonexistentToken/);
  });
});
