// Case memory on top of the Meterless H-MEM reference engine (vendored,
// unmodified, in src/engines/hmem). Every finished investigation becomes a
// sourced, provenance-tracked memory; later investigations recall it; analyst
// feedback (helpful / wrong) moves its confidence through H-MEM's trust ledger;
// a re-investigation of the same agent+action supersedes the old verdict.
import { HMEM, type MemoryRecord, type FeedbackKind } from "../engines/hmem/index.ts";

export interface CaseSummary {
  caseId: string; agentName: string; officialAgentId: number; action: string; verdict: string; headline: string; keyFacts: string[];
}

export class CaseMemory {
  readonly hmem: HMEM;
  constructor(persistDir = process.env.TRUSTDESK_MEMORY_DIR ?? ".state/hmem", clock: () => number = Date.now) {
    this.hmem = new HMEM({ persistDir, clock, actor: "trust-desk" });
  }

  recall(query: string, topN = 5) {
    const r = this.hmem.query(query, { topN, threshold: 0.2 });
    return {
      strategy: r.trace.strategy,
      memories: r.memories.map((m) => ({ id: m.memory.id, relevance: Number(m.relevance.toFixed(3)), confidence: m.memory.confidence,
        content: m.memory.content, source: m.memory.source, supersededBy: m.memory.supersededBy ?? null, learnedAt: new Date(m.memory.provenance.learnedAt).toISOString() })),
    };
  }

  private priorFor(agentName: string, action: string): MemoryRecord | undefined {
    return this.hmem.store.all()
      .filter((m) => !m.supersededBy && m.tags.includes(`agent:${agentName.toLowerCase()}`) && m.tags.includes(`action:${slug(action)}`))
      .sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  remember(c: CaseSummary): { record: MemoryRecord; superseded: string | null } {
    const prior = this.priorFor(c.agentName, c.action);
    const content = `Case ${c.caseId}: ${c.agentName} (ERC-8004 #${c.officialAgentId}) asked to "${c.action}" -> ${c.verdict}. ${c.headline} Facts: ${c.keyFacts.join("; ")}`;
    const record = this.hmem.add({
      content, type: "factual", layer: "working", confidence: 0.8,
      tags: ["trust-case", `agent:${c.agentName.toLowerCase()}`, `action:${slug(c.action)}`, `verdict:${c.verdict.toLowerCase()}`],
      source: `trust-desk:${c.caseId}`,
      provenance: { origin: "plan_completion", learnedAt: this.hmem.clock(), label: `investigation ${c.caseId}`, refs: [c.caseId] },
      supersedes: prior?.id,
    });
    if (prior) {
      // Mark the old verdict superseded (kept + penalised, never deleted), the H-MEM way.
      this.hmem.store.update(prior.id, { supersededBy: record.id });
    }
    this.hmem.store.persist();
    return { record, superseded: prior?.id ?? null };
  }

  feedback(memoryId: string, kind: FeedbackKind) { this.hmem.feedback(memoryId, kind); this.hmem.store.persist(); return this.hmem.store.get(memoryId); }
  history(memoryId: string) { return this.hmem.ledger.history(memoryId); }
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
