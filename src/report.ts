import type { CaseReport } from "./agent/investigator.ts";
const C = { GRANT: "\x1b[32m", CAUTION: "\x1b[33m", DENY: "\x1b[31m" } as const;
export function printReport(r: CaseReport) {
  const v = r.finalVerdict; const reset = "\x1b[0m";
  console.log(`\n${C[v]}■ ${v}${reset}  ${r.question.agentName} → "${r.question.action}"  (${r.caseId})`);
  if (r.modelVerdict) console.log(`  ${r.modelVerdict.headline}`);
  console.log(`  model verdict: ${r.modelVerdict?.verdict ?? "none"} · policy floor: ${r.policy.floor} · final: ${v}`);
  console.log("\n  WHY");
  for (const x of r.modelVerdict?.reasons ?? []) console.log(`   • ${x.claim}  [${x.evidence.join(", ")}]${x.grounding?.unverified.length ? `  ⚠ not literally in cited evidence: ${x.grounding.unverified.join(", ")}` : ""}`);
  if (r.policy.triggers.length) { console.log("\n  POLICY TRIGGERS"); for (const t of r.policy.triggers) console.log(`   • ${t.level.padEnd(7)} ${t.rule}: ${t.detail}  [${t.evidence.join(", ")}]`); }
  console.log("\n  EVIDENCE");
  for (const e of r.evidence) console.log(`   ${e.id.padEnd(4)} ${e.kind.padEnd(8)} ${e.summary}\n        ↳ ${e.source}`);
  console.log(`\n  providers: ${r.providers.calls.map((c) => `${c.provider}:${c.model.split("/").pop()}`).filter((x, i, a) => a.indexOf(x) === i).join(", ")} · routing: ${JSON.stringify(r.providers.routing[0] ?? {})}`);
  console.log(`  memory: stored ${r.memory.stored}${r.memory.superseded ? ` (supersedes ${r.memory.superseded})` : ""} · zetaris engine: ${r.environment.zetarisEngine}\n`);
}
