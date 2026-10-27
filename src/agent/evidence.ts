export type SourceKind = "onchain" | "zetaris" | "memory" | "guard" | "derived";
export interface Evidence {
  id: string;            // E1, E2 ...
  kind: SourceKind;
  source: string;        // e.g. "Monad testnet AgentID scorer getWeightedReputation(3) @ block 74525377"
  summary: string;       // one line, human readable
  data: unknown;         // the raw rows / values
  link?: string;         // explorer / dataset URL
  engine?: string;       // zetaris | zetaris-sim | monad-rpc | hmem
}
export class EvidenceLog {
  readonly items: Evidence[] = [];
  add(e: Omit<Evidence, "id">): Evidence { const it = { id: `E${this.items.length + 1}`, ...e }; this.items.push(it); return it; }
  has(id: string) { return this.items.some((e) => e.id === id); }
  get(id: string) { return this.items.find((e) => e.id === id); }
}
