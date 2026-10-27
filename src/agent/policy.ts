// Deterministic trust policy. The model explains; the policy sets a floor.
// Final verdict = the stricter of (model verdict, policy floor), and every
// trigger names the evidence it came from.
export type Verdict = "GRANT" | "CAUTION" | "DENY";
export const RANK: Record<Verdict, number> = { GRANT: 0, CAUTION: 1, DENY: 2 };
export const stricter = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);

export interface Signals {
  sensitivity?: "low" | "high";
  vendorFound?: boolean;
  kybStatus?: string;
  contractStatus?: string;
  declaredOwner?: string;
  onchainOwner?: string | null;
  rawX100?: number;
  weightedX100?: number;
  feedbackClients?: number;
  knownFeedbackClients?: number;
  openHighIncidents?: number;
  openIncidents?: number;
  outOfScopeCalls?: number;
  piiFieldsRequested?: number;
  injectionHits?: number;
  evidence: Partial<Record<string, string[]>>; // signal -> evidence ids
}

export interface Trigger { rule: string; level: Verdict; detail: string; evidence: string[] }

const HIGH = /refund|payment|pay|payout|transfer|wallet|invoice|money|pii|customer data|export|write|admin|delete/i;
export const classifyAction = (action: string): "low" | "high" => (HIGH.test(action) ? "high" : "low");

export function evaluate(s: Signals): { floor: Verdict; triggers: Trigger[] } {
  const t: Trigger[] = [];
  const ev = (k: string) => s.evidence[k] ?? [];
  const high = s.sensitivity === "high";
  if (s.vendorFound === false) t.push({ rule: "unknown_vendor", level: "DENY", detail: "agent is not in the vendor-risk register", evidence: ev("vendor") });
  if (s.kybStatus === "failed") t.push({ rule: "kyb_failed", level: "DENY", detail: "vendor KYB failed", evidence: ev("vendor") });
  if (s.kybStatus === "pending") t.push({ rule: "kyb_pending", level: high ? "DENY" : "CAUTION", detail: `vendor KYB still pending (${high ? "high" : "low"}-sensitivity action)`, evidence: ev("vendor") });
  if (s.declaredOwner && s.onchainOwner && s.declaredOwner.toLowerCase() !== s.onchainOwner.toLowerCase())
    t.push({ rule: "owner_mismatch", level: "DENY", detail: `declared owner ${s.declaredOwner} != on-chain ERC-8004 owner ${s.onchainOwner}`, evidence: [...ev("vendor"), ...ev("onchain")] });
  if ((s.openHighIncidents ?? 0) > 0) t.push({ rule: "open_high_incident", level: "DENY", detail: `${s.openHighIncidents} open high-severity incident(s)`, evidence: ev("incidents") });
  if ((s.outOfScopeCalls ?? 0) > 0) t.push({ rule: "out_of_scope_calls", level: "DENY", detail: `${s.outOfScopeCalls} out-of-scope API calls on its sandbox key`, evidence: ev("gateway") });
  if (s.rawX100 !== undefined && s.weightedX100 !== undefined) {
    const gap = s.rawX100 - s.weightedX100;
    if (gap >= 100) t.push({ rule: "reputation_inflation", level: "CAUTION", detail: `raw ${(s.rawX100 / 100).toFixed(2)} vs trust-weighted ${(s.weightedX100 / 100).toFixed(2)}: raw score is inflated by low-trust reviewers`, evidence: ev("onchain") });
    if (s.weightedX100 < 200) t.push({ rule: "low_weighted_reputation", level: high ? "DENY" : "CAUTION", detail: `trust-weighted reputation ${(s.weightedX100 / 100).toFixed(2)} < 2.00`, evidence: ev("onchain") });
  }
  if (s.feedbackClients && s.knownFeedbackClients !== undefined) {
    const unknown = s.feedbackClients - s.knownFeedbackClients;
    if (unknown / s.feedbackClients >= 0.5) t.push({ rule: "unknown_reviewers", level: "CAUTION", detail: `${unknown}/${s.feedbackClients} on-chain reviewers have no customer record`, evidence: [...ev("onchain"), ...ev("crossref")] });
  }
  if ((s.injectionHits ?? 0) > 0) t.push({ rule: "prompt_injection_attempt", level: high ? "DENY" : "CAUTION", detail: "third-party text tried to steer the reviewer", evidence: ev("guard") });
  if ((s.openIncidents ?? 0) > (s.openHighIncidents ?? 0)) t.push({ rule: "open_incident", level: "CAUTION", detail: "an incident is still open / investigating", evidence: ev("incidents") });
  const floor = t.reduce<Verdict>((v, x) => stricter(v, x.level), "GRANT");
  return { floor, triggers: t };
}
