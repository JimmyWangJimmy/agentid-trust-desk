// Read-only Monad testnet reader for AgentID (scorer) and the official
// ERC-8004 Identity + Reputation registries. No keys, no writes.
import { createPublicClient, http, fallback, defineChain, parseAbi, type Address } from "viem";

export const MONAD_TESTNET = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
});

export const ADDRESSES = {
  agentIdScorer: "0x8916357EDB7598d20E257404213CF3D1C099c310" as Address,
  erc8004Identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  erc8004Reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
};

const scorerAbi = parseAbi([
  "function getReputation(uint256 agentId) view returns (int256 score, uint256 count, uint256 weightSum)",
  "function getWeightedReputation(uint256 agentId) view returns (int256 score, uint256 count, uint256 weightSum)",
]);
const identityAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
const reputationAbi = parseAbi([
  "function getClients(uint256 agentId) view returns (address[])",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
]);

export interface OnchainReport {
  scorerAgentId: number;
  officialAgentId: number;
  rawScoreX100: number;
  weightedScoreX100: number;
  attestationCount: number;
  weightSumRaw: string;
  weightSumWeighted: string;
  officialOwner: string | null;
  officialTokenURI: string | null;
  feedbackClients: string[];
  officialSummary: { count: number; value: number; decimals: number } | null;
  blockNumber: string;
  rpc: string;
  explorer: { scorer: string; identity: string; reputation: string };
}

export function rpcUrls(): string[] {
  return (process.env.MONAD_RPC_URLS ?? "https://monad-testnet.drpc.org,https://testnet-rpc.monad.xyz")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export function makeClient(urls = rpcUrls()) {
  return createPublicClient({
    chain: MONAD_TESTNET,
    transport: fallback(urls.map((u) => http(u, { timeout: 20_000, retryCount: 1 }))),
  });
}

const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

export async function readAgentOnchain(scorerAgentId: number, officialAgentId: number, client = makeClient()): Promise<OnchainReport> {
  const id = BigInt(scorerAgentId);
  const oid = BigInt(officialAgentId);
  const [blockNumber, raw, weighted, owner, uri, clients] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: ADDRESSES.agentIdScorer, abi: scorerAbi, functionName: "getReputation", args: [id] }),
    client.readContract({ address: ADDRESSES.agentIdScorer, abi: scorerAbi, functionName: "getWeightedReputation", args: [id] }),
    safe(client.readContract({ address: ADDRESSES.erc8004Identity, abi: identityAbi, functionName: "ownerOf", args: [oid] })),
    safe(client.readContract({ address: ADDRESSES.erc8004Identity, abi: identityAbi, functionName: "tokenURI", args: [oid] })),
    safe(client.readContract({ address: ADDRESSES.erc8004Reputation, abi: reputationAbi, functionName: "getClients", args: [oid] })),
  ]);
  const feedbackClients = [...(clients ?? [])].map((a) => a.toLowerCase());
  let officialSummary: OnchainReport["officialSummary"] = null;
  if (feedbackClients.length) {
    const s = await safe(client.readContract({
      address: ADDRESSES.erc8004Reputation, abi: reputationAbi, functionName: "getSummary",
      args: [oid, feedbackClients as Address[], "", ""],
    }));
    if (s) officialSummary = { count: Number(s[0]), value: Number(s[1]), decimals: Number(s[2]) };
  }
  const ex = MONAD_TESTNET.blockExplorers.default.url;
  return {
    scorerAgentId, officialAgentId,
    rawScoreX100: Number(raw[0]), weightedScoreX100: Number(weighted[0]),
    attestationCount: Number(raw[1]),
    weightSumRaw: raw[2].toString(), weightSumWeighted: weighted[2].toString(),
    officialOwner: owner ? owner.toLowerCase() : null,
    officialTokenURI: uri ?? null,
    feedbackClients, officialSummary,
    blockNumber: blockNumber.toString(),
    rpc: rpcUrls().join(" | "),
    explorer: {
      scorer: `${ex}/address/${ADDRESSES.agentIdScorer}`,
      identity: `${ex}/address/${ADDRESSES.erc8004Identity}`,
      reputation: `${ex}/address/${ADDRESSES.erc8004Reputation}`,
    },
  };
}
