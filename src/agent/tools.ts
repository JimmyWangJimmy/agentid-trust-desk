import { readAgentOnchain, type OnchainReport } from "../chain/monad.ts";
import { ZetarisClient, toObjects } from "../zetaris/client.ts";
import { CaseMemory } from "../memory/caseMemory.ts";
import { guardRows } from "./guard.ts";
import { EvidenceLog } from "./evidence.ts";
import type { Signals } from "./policy.ts";
import type { ToolSpec } from "../llm/types.ts";

const q = (s: string) => `'${String(s).replace(/'/g, "''")}'`;
const isAddr = (s: string) => /^0x[0-9a-f]{40}$/i.test(s);

export interface ToolContext {
  zetaris: ZetarisClient;
  memory: CaseMemory;
  evidence: EvidenceLog;
  signals: Signals;
  onchainCache: Map<number, OnchainReport>;
  coverage: Set<string>;
  onchainReader?: typeof readAgentOnchain;
}

export const TOOL_SPECS: ToolSpec[] = [
  { type: "function", function: { name: "lookup_vendor", description: "Zetaris: read the procurement / vendor-risk register row for an agent (KYB, contract, declared owner wallet, ERC-8004 ids).", parameters: { type: "object", properties: { agent_name: { type: "string" } }, required: ["agent_name"] } } },
  { type: "function", function: { name: "onchain_reputation", description: "Monad testnet: read AgentID raw vs trust-weighted reputation (scorer id) and the official ERC-8004 owner, agentURI and feedback clients (official id).", parameters: { type: "object", properties: { scorer_agent_id: { type: "integer" }, official_agent_id: { type: "integer" } }, required: ["scorer_agent_id", "official_agent_id"] } } },
  { type: "function", function: { name: "crossref_feedback_wallets", description: "Federated join: on-chain ERC-8004 feedback client wallets x Zetaris CRM customer_wallets. Tells genuine customers from fresh wallets.", parameters: { type: "object", properties: { official_agent_id: { type: "integer" }, scorer_agent_id: { type: "integer" } }, required: ["official_agent_id", "scorer_agent_id"] } } },
  { type: "function", function: { name: "incident_history", description: "Zetaris: incident-tracker tickets that mention the agent.", parameters: { type: "object", properties: { agent_name: { type: "string" } }, required: ["agent_name"] } } },
  { type: "function", function: { name: "gateway_usage", description: "Zetaris: API-gateway aggregates for the agent's sandbox key (requests, error rate, out-of-scope calls, PII fields).", parameters: { type: "object", properties: { agent_name: { type: "string" } }, required: ["agent_name"] } } },
  { type: "function", function: { name: "zetaris_sql", description: "Zetaris: run one read-only SELECT over trustdesk.vendor_registry, trustdesk.customer_wallets, trustdesk.incidents, trustdesk.gateway_usage, trustdesk.agent_cards.", parameters: { type: "object", properties: { sql: { type: "string" }, purpose: { type: "string" } }, required: ["sql", "purpose"] } } },
  { type: "function", function: { name: "recall_case_memory", description: "Meterless H-MEM: recall prior investigations, verdicts and analyst corrections relevant to a query.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
];

export const REQUIRED_COVERAGE = ["vendor", "onchain", "crossref", "incidents", "gateway", "memory"];

async function zrun(ctx: ToolContext, sql: string, label: string, signalKey: string) {
  const r = await ctx.zetaris.run(sql, { limit: 50 });
  const objs = toObjects(r);
  const g = guardRows(objs, label);
  const e = ctx.evidence.add({
    kind: "zetaris", engine: r.engine, source: `${r.engine === "zetaris-sim" ? "Zetaris REST contract -> zetaris-sim (local simulator)" : "Zetaris"} · ${label} · queryId ${r.queryId.slice(0, 8)}`,
    summary: `${objs.length} row(s) from ${label}`, data: { sql, rows: g.rows },
  });
  (ctx.signals.evidence[signalKey] ??= []).push(e.id);
  if (g.hits.length) {
    const ge = ctx.evidence.add({ kind: "guard", source: "untrusted-text guard", summary: `prompt-injection attempt in ${[...new Set(g.hits.map((h) => h.where))].join(", ")} (${[...new Set(g.hits.map((h) => h.pattern))].join(", ")})`, data: g.hits });
    (ctx.signals.evidence.guard ??= []).push(ge.id);
    ctx.signals.injectionHits = (ctx.signals.injectionHits ?? 0) + g.hits.length;
  }
  return { evidence_id: e.id, engine: r.engine, rows: g.rows, guard_hits: g.hits.length };
}

async function chain(ctx: ToolContext, scorer: number, official: number) {
  let r = ctx.onchainCache.get(official);
  if (!r) { r = await (ctx.onchainReader ?? readAgentOnchain)(scorer, official); ctx.onchainCache.set(official, r); }
  return r;
}

export async function runTool(ctx: ToolContext, name: string, args: any): Promise<unknown> {
  const s = ctx.signals;
  switch (name) {
    case "lookup_vendor": {
      ctx.coverage.add("vendor");
      const out = await zrun(ctx, `SELECT agent_name, scorer_agent_id, official_agent_id, vendor_org, kyb_status, contract_status, declared_owner_wallet, business_owner, onboarded_at, self_description FROM trustdesk.vendor_registry WHERE lower(agent_name) = lower(${q(args.agent_name)})`, "trustdesk.vendor_registry", "vendor");
      const v = out.rows[0] as any;
      s.vendorFound = !!v;
      if (v) { s.kybStatus = v.kyb_status; s.contractStatus = v.contract_status; s.declaredOwner = v.declared_owner_wallet; }
      return out;
    }
    case "onchain_reputation": {
      ctx.coverage.add("onchain");
      const r = await chain(ctx, Number(args.scorer_agent_id), Number(args.official_agent_id));
      s.rawX100 = r.rawScoreX100; s.weightedX100 = r.weightedScoreX100; s.onchainOwner = r.officialOwner; s.feedbackClients = r.feedbackClients.length;
      const e = ctx.evidence.add({ kind: "onchain", engine: "monad-rpc", link: r.explorer.scorer,
        source: `Monad testnet (chain 10143) @ block ${r.blockNumber}: AgentID scorer getReputation/getWeightedReputation(${r.scorerAgentId}); ERC-8004 Identity ownerOf/tokenURI(${r.officialAgentId}); Reputation getClients/getSummary(${r.officialAgentId})`,
        summary: `raw ${(r.rawScoreX100 / 100).toFixed(2)} vs weighted ${(r.weightedScoreX100 / 100).toFixed(2)} from ${r.attestationCount} attestations; ERC-8004 owner ${r.officialOwner}; ${r.feedbackClients.length} feedback clients; official getSummary ${r.officialSummary ? r.officialSummary.value : "n/a"}`,
        data: r });
      (s.evidence.onchain ??= []).push(e.id);
      return { evidence_id: e.id, raw_score: r.rawScoreX100 / 100, weighted_score: r.weightedScoreX100 / 100, attestations: r.attestationCount, erc8004_owner: r.officialOwner, agent_uri: r.officialTokenURI, feedback_clients: r.feedbackClients, official_summary: r.officialSummary, block: r.blockNumber };
    }
    case "crossref_feedback_wallets": {
      ctx.coverage.add("crossref");
      const r = await chain(ctx, Number(args.scorer_agent_id), Number(args.official_agent_id));
      const wallets = r.feedbackClients.filter(isAddr);
      if (!wallets.length) return { feedback_clients: 0, known_customers: [] };
      const out = await zrun(ctx, `SELECT wallet, customer_id, segment, first_order, orders_90d FROM trustdesk.customer_wallets WHERE lower(wallet) IN (${wallets.map(q).join(", ")})`, "trustdesk.customer_wallets x ERC-8004 getClients", "crossref");
      const known = new Set(out.rows.map((x: any) => String(x.wallet).toLowerCase()));
      s.feedbackClients = wallets.length; s.knownFeedbackClients = known.size;
      return { ...out, feedback_clients: wallets.length, known_customer_wallets: [...known], unknown_wallets: wallets.filter((w) => !known.has(w)) };
    }
    case "incident_history": {
      ctx.coverage.add("incidents");
      const out = await zrun(ctx, `SELECT ticket_id, severity, category, opened_at, status, summary FROM trustdesk.incidents WHERE lower(agent_name) = lower(${q(args.agent_name)}) ORDER BY opened_at`, "trustdesk.incidents", "incidents");
      const open = out.rows.filter((x: any) => x.status !== "resolved");
      s.openIncidents = open.length; s.openHighIncidents = open.filter((x: any) => x.severity === "high").length;
      return out;
    }
    case "gateway_usage": {
      ctx.coverage.add("gateway");
      const out = await zrun(ctx, `SELECT usage_window, requests, error_rate, out_of_scope_calls, pii_fields_requested, rate_limit_hits, scopes FROM trustdesk.gateway_usage WHERE lower(agent_name) = lower(${q(args.agent_name)})`, "trustdesk.gateway_usage", "gateway");
      const g = out.rows[0] as any;
      if (g) { s.outOfScopeCalls = Number(g.out_of_scope_calls); s.piiFieldsRequested = Number(g.pii_fields_requested); }
      return out;
    }
    case "zetaris_sql": {
      const sql = String(args.sql ?? "");
      if (!/^\s*(select|with)\b/i.test(sql) || /;\s*\S/.test(sql)) return { error: "only a single read-only SELECT is allowed" };
      if (!/\btrustdesk\./i.test(sql)) return { error: "query must read trustdesk.* views" };
      return zrun(ctx, sql.replace(/;\s*$/, ""), `ad-hoc: ${String(args.purpose ?? "").slice(0, 60)}`, "adhoc");
    }
    case "recall_case_memory": {
      ctx.coverage.add("memory");
      const r = ctx.memory.recall(String(args.query ?? ""));
      const e = ctx.evidence.add({ kind: "memory", engine: "hmem", source: `Meterless H-MEM recall ("${String(args.query).slice(0, 60)}", strategy ${r.strategy})`, summary: `${r.memories.length} prior case memories`, data: r.memories });
      (s.evidence.memory ??= []).push(e.id);
      return { evidence_id: e.id, ...r };
    }
    default: return { error: `unknown tool ${name}` };
  }
}
