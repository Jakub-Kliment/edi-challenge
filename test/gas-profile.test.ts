import { describe, it } from "node:test";
import { network } from "hardhat";

/** Measures real mint cost across image sizes, to pick the server-side target. */
describe("gas profile", () => {
  it("reports mint cost by image size", async () => {
    const { viem } = await network.getOrCreate();
    const wallets = await viem.getWalletClients();
    const pub = await viem.getPublicClient();
    const badge = {
      firstName: "Jakub", lastName: "Kliment", mainProject: "EDI Challenge 2026",
      startDate: "2026-08-18", completionDate: "2026-08-18",
      details: "Built a fully on-chain badge minter on Polygon Amoy",
      imagePointer: "0x0000000000000000000000000000000000000000" as `0x${string}`, imageMime: 0,
    };
    const GWEI = 30;
    const BALANCE = 5.112; // POL currently held by the relayer
    console.log("\n  size    gas         POL @30gwei    mints affordable");
    console.log("  " + "-".repeat(58));
    for (const kb of [4, 8, 12, 16, 20, 23]) {
      const c = await viem.deployContract("ExitBadge", [wallets[0].account.address]);
      const n = kb * 1024;
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = 1 + (i % 254);
      const hex = ("0x" + Buffer.from(b).toString("hex")) as `0x${string}`;
      const hash = await c.write.mint([wallets[1].account.address, badge, hex]);
      const r = await pub.waitForTransactionReceipt({ hash });
      const pol = Number(r.gasUsed) * GWEI * 1e-9;
      console.log(
        `  ${String(kb + "KB").padEnd(6)}  ${r.gasUsed.toLocaleString().padStart(10)}  ${pol.toFixed(4).padStart(10)} POL  ${Math.floor(BALANCE / pol).toString().padStart(10)}x`
      );
    }
    console.log("");
  });
});
