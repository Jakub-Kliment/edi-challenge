/**
 * One-off: mint a badge to the relayer's OWN address on Amoy, to verify the
 * whole pipeline end-to-end against a real wallet before ever minting to the
 * examiner. Not part of the app — a manual verification step.
 */
import { network } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";

async function main() {
  const { viem } = await network.getOrCreate("amoy" as const);
  const [signer] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  const contractAddr = process.env.NEXT_PUBLIC_CONTRACT_AMOY as `0x${string}`;
  if (!contractAddr) throw new Error("NEXT_PUBLIC_CONTRACT_AMOY not set");
  const badge = await viem.getContractAt("ExitBadge", contractAddr);

  // A small real WebP, not synthetic bytes — a genuine test of the whole
  // pipeline including sharp's actual encoder, not just SSTORE2 mechanics.
  const imageBuf = readFileSync("/tmp/test-badge-image-png.png");
  console.log("image size:", imageBuf.length, "bytes");
  const imageHex = ("0x" + imageBuf.toString("hex")) as `0x${string}`;

  const fields = {
    firstName: "Jakub",
    lastName: "Kliment",
    mainProject: "EDI Challenge 2026",
    startDate: "2026-08-18",
    completionDate: "2026-08-18",
    details: "Verifying the on-chain badge renders correctly before minting to the examiner",
    imagePointer: "0x0000000000000000000000000000000000000000" as const,
    imageMime: 1, // PNG — see D22, WebP does not render inside embedded SVG
  };

  console.log("minting to (self):", signer.account.address);
  const hash = await badge.write.mint([signer.account.address, fields, imageHex]);
  console.log("tx:", hash);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  console.log("gas used:", receipt.gasUsed.toString());
  console.log("status  :", receipt.status);

  const tokenId = (await badge.read.totalMinted()) as bigint;
  console.log("\ntoken ID:", tokenId.toString());
  console.log("owner   :", await badge.read.ownerOf([tokenId]));
  console.log("\nPolygonScan:", `https://amoy.polygonscan.com/tx/${hash}`);
  console.log("Token page :", `https://amoy.polygonscan.com/token/${contractAddr}?a=${tokenId}`);

  const uri = await badge.read.tokenURI([tokenId]);
  const json = JSON.parse(Buffer.from((uri as string).split(",")[1], "base64").toString());
  const svg = Buffer.from(json.image.split(",")[1], "base64").toString();
  writeFileSync("/tmp/minted-badge.svg", svg);
  console.log("\nSaved rendered SVG to /tmp/minted-badge.svg for visual inspection");
  console.log("Metadata name:", json.name);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
