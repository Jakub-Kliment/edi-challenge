import Link from "next/link";
import { createPublicClient, http } from "viem";
import { polygonAmoy } from "viem/chains";
import { EXIT_BADGE_ABI } from "@/lib/abi";
import { CHAINS } from "@/lib/relayer";
import { GalleryGrid, type GalleryBadge } from "@/components/GalleryGrid";

/**
 * Not an indexer — no database, no event log, no cron. On every request this
 * reads `totalMinted()` and walks the last 20 token IDs downward, decoding
 * each `tokenURI()` directly from the chain. Token IDs are a plain incrementing
 * counter with no burn function (contracts/ExitBadge.sol), so every ID from 1
 * to totalMinted() is guaranteed to exist — no gaps to guard against, unlike a
 * contract that supports burning.
 *
 * This does not scale past a few hundred tokens (each view re-fetches
 * everything, and it always reads from the newest end) but is the honest
 * amount of infrastructure for a demo-sized collection. A real indexer
 * (subgraph / Alchemy NFT API / a poller writing to a DB) is the correct next
 * step if the collection grows or "search by owner" is ever needed. The
 * wallet filter below is client-side filtering over these same 20 badges,
 * not a real query — it cannot find a badge outside the fetched window.
 */

export const revalidate = 30;

const GALLERY_SIZE = 20;

async function fetchLatestBadges(): Promise<{ badges: GalleryBadge[]; error?: string }> {
  const rpc = process.env.AMOY_RPC_URL;
  const contract = process.env.NEXT_PUBLIC_CONTRACT_AMOY;
  if (!rpc || !contract || !/^0x[0-9a-fA-F]{40}$/.test(contract)) {
    return { badges: [], error: "Gallery is not configured on this deployment." };
  }

  const client = createPublicClient({ chain: CHAINS.amoy.chain ?? polygonAmoy, transport: http(rpc) });
  const address = contract as `0x${string}`;
  const explorer = CHAINS.amoy.explorer;

  let total: bigint;
  try {
    total = (await client.readContract({
      address,
      abi: EXIT_BADGE_ABI,
      functionName: "totalMinted",
    })) as bigint;
  } catch {
    return { badges: [], error: "Could not reach the chain to load the gallery." };
  }

  if (total === 0n) return { badges: [] };

  const ids: bigint[] = [];
  for (let id = total; id > 0n && ids.length < GALLERY_SIZE; id--) ids.push(id);

  const results = await Promise.all(
    ids.map(async (tokenId) => {
      try {
        const [uri, owner] = await Promise.all([
          client.readContract({ address, abi: EXIT_BADGE_ABI, functionName: "tokenURI", args: [tokenId] }) as Promise<string>,
          client.readContract({ address, abi: EXIT_BADGE_ABI, functionName: "ownerOf", args: [tokenId] }) as Promise<`0x${string}`>,
        ]);
        const json = JSON.parse(
          Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString("utf-8"),
        );
        const attributes = (json.attributes ?? []) as { trait_type: string; value: string }[];
        const project = attributes.find((a) => a.trait_type === "Project")?.value ?? "";
        return {
          tokenId: tokenId.toString(),
          owner,
          name: json.name as string,
          imageDataUri: json.image as string,
          project,
          explorerUrl: `${explorer}/nft/${address}/${tokenId.toString()}`,
        } satisfies GalleryBadge;
      } catch {
        return null;
      }
    }),
  );

  return { badges: results.filter((b): b is GalleryBadge => b !== null) };
}

export default async function Gallery() {
  const { badges, error } = await fetchLatestBadges();

  return (
    <main className="shell">
      <div className="accent-rule" />
      <header className="masthead gallery-masthead">
        <h1>Latest badges</h1>
        <Link href="/" className="gallery-back">← Mint a badge</Link>
      </header>

      {error ? (
        <p className="hint">{error}</p>
      ) : badges.length === 0 ? (
        <p className="hint">No badges minted yet.</p>
      ) : (
        <GalleryGrid badges={badges} />
      )}
    </main>
  );
}
