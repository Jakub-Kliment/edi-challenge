/**
 * Deploy ExitBadge to Amoy (or mainnet) and print everything needed for
 * lib/relayer.ts's env vars and the submission email.
 *
 * The deployer/owner is the relayer account itself (see lib/relayer.ts) —
 * mint() is onlyOwner, and the relayer is the only caller that should ever
 * need to invoke it.
 */
import { network } from "hardhat";

async function main() {
  const { viem } = await network.getOrCreate("amoy" as const);
  const [deployer] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();

  console.log("deployer  :", deployer.account.address);
  const balance = await pub.getBalance({ address: deployer.account.address });
  console.log("balance   :", (Number(balance) / 1e18).toFixed(4), "POL");

  console.log("\ndeploying ExitBadge...");
  const badge = await viem.deployContract("ExitBadge", [deployer.account.address]);
  console.log("deployed  :", badge.address);

  // viem's deployContract() waits for the receipt internally but does not
  // expose it on the returned contract instance in this Hardhat 3 setup —
  // fetch it by code presence instead of assuming a `deploymentTransaction`
  // field exists.
  const code = await pub.getBytecode({ address: badge.address });
  console.log("has code  :", Boolean(code), code ? `(${(code.length - 2) / 2} bytes)` : "");

  console.log("\n--- add to .env ---");
  console.log(`NEXT_PUBLIC_CONTRACT_AMOY="${badge.address}"`);
  console.log("\n--- for the submission ---");
  console.log("contract  :", badge.address);
  console.log("explorer  :", `https://amoy.polygonscan.com/address/${badge.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
