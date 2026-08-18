import { createPublicClient, createWalletClient, http, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy, polygon } from "viem/chains";

/**
 * The relayer signs and pays for every mint, so that users need neither a wallet
 * nor testnet POL — the constraint that shapes this whole application.
 *
 * It holds a funded key behind a public, unauthenticated endpoint, so the key is
 * a dedicated burner holding only a small balance. Worst case, someone drains a
 * throwaway testnet wallet.
 */

export type ChainKey = "amoy" | "polygon";

export const CHAINS = {
  amoy: {
    chain: polygonAmoy,
    rpcEnv: "AMOY_RPC_URL",
    contractEnv: "NEXT_PUBLIC_CONTRACT_AMOY",
    explorer: "https://amoy.polygonscan.com",
    label: "Polygon Amoy",
  },
  polygon: {
    chain: polygon,
    rpcEnv: "POLYGON_RPC_URL",
    contractEnv: "NEXT_PUBLIC_CONTRACT_POLYGON",
    explorer: "https://polygonscan.com",
    label: "Polygon",
  },
} as const;

export class RelayerConfigError extends Error {}

/** Private keys are commonly pasted without the 0x prefix; viem requires it. */
function normalizeKey(raw: string): Hex {
  const k = raw.trim();
  const withPrefix = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new RelayerConfigError("RELAYER_PRIVATE_KEY is not a valid 32-byte hex key");
  }
  return withPrefix as Hex;
}

export function getRelayerAccount() {
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) throw new RelayerConfigError("RELAYER_PRIVATE_KEY is not set");
  return privateKeyToAccount(normalizeKey(key));
}

export function getContractAddress(chainKey: ChainKey): Address {
  const cfg = CHAINS[chainKey];
  const addr = process.env[cfg.contractEnv];
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new RelayerConfigError(`${cfg.contractEnv} is not set to a valid contract address`);
  }
  return addr as Address;
}

export function getClients(chainKey: ChainKey) {
  const cfg = CHAINS[chainKey];
  const rpc = process.env[cfg.rpcEnv];
  if (!rpc) throw new RelayerConfigError(`${cfg.rpcEnv} is not set`);

  const account = getRelayerAccount();
  const transport = http(rpc);
  return {
    account,
    publicClient: createPublicClient({ chain: cfg.chain, transport }),
    walletClient: createWalletClient({ account, chain: cfg.chain, transport }),
    explorer: cfg.explorer,
  };
}

/**
 * Serialise mints within this process.
 *
 * Two concurrent requests that both read the pending nonce get the same number;
 * the second transaction then replaces the first, and one user silently loses
 * their badge. A promise chain is enough to make that impossible here.
 *
 * Caveat worth stating: serverless instances do not share memory, so this does
 * not protect against collisions across simultaneous cold starts. Closing that
 * properly needs an external lock (Redis). At the volume this app will see, the
 * in-process lock plus the nonce retry below covers the realistic cases.
 */
let mintQueue: Promise<unknown> = Promise.resolve();

export function withNonceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mintQueue.then(fn, fn);
  // Keep the chain alive regardless of individual failures.
  mintQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** viem/RPC nonce errors vary by provider; match them loosely. */
export function isNonceError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes("nonce too low") ||
    msg.includes("nonce is too low") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("already known")
  );
}
