// Recorded demo: four investigations in sequence, traces written to docs/runs for the Pages viewer.
// Requires NVIDIA_API_KEY (fallback) or a Meterless Runtime. Starts zetaris-sim unless ZETARIS_REAL=1.
import fs from "node:fs";
import { loadEnv } from "../src/env.ts";
import { investigate } from "../src/agent/investigator.ts";
import { printReport } from "../src/report.ts";
import { autoDetect } from "../src/llm/meterless.ts";
loadEnv();
const CASES = [
  { agentName: "GoodBot", action: "read shipment tracking status for customer orders" },
  { agentName: "FakeBot", action: "export the customer contact list to send delivery notifications" },
  { agentName: "SybilBot", action: "issue customer refunds up to $500" },
  { agentName: "SybilBot", action: "answer customer FAQ questions in the support chat" },
];
let sim: { close: () => Promise<void>; url: string } | undefined;
if (process.env.ZETARIS_REAL !== "1") {
  const { startSim } = await import("../src/zetaris/sim-server.ts");
  process.env.ZETARIS_API_KEY ??= "sim-local-key";
  sim = await startSim(Number(process.env.ZETARIS_SIM_PORT ?? 8899), process.env.ZETARIS_API_KEY);
  process.env.ZETARIS_REST_URL = sim.url;
}
const detected = await autoDetect(process.env.METERLESS_RUNTIME_TOKEN || "probe");
const outDir = process.env.DEMO_OUT ?? "docs/runs";
fs.mkdirSync(outDir, { recursive: true });
const only = process.argv[2] ? [Number(process.argv[2])] : CASES.map((_, i) => i);
const index: unknown[] = fs.existsSync(`${outDir}/index.json`) ? JSON.parse(fs.readFileSync(`${outDir}/index.json`, "utf-8")) : [];
for (const i of only) {
  const c = CASES[i];
  console.log(`\n=== case ${i + 1}: ${c.agentName} -> ${c.action}`);
  const r = await investigate({ ...c, onStep: (s) => console.log(`  · ${s.type}${s.tool ? ` ${s.tool}` : ""}`) });
  (r.environment as any).meterlessDetect = detected ?? "not found";
  printReport(r);
  const file = `case${i + 1}-${c.agentName.toLowerCase()}.json`;
  fs.writeFileSync(`${outDir}/${file}`, JSON.stringify(r, null, 2));
  const entry = { file, n: i + 1, agent: c.agentName, action: c.action, verdict: r.finalVerdict, caseId: r.caseId, at: r.finishedAt };
  const k = (index as any[]).findIndex((x) => x.n === i + 1);
  if (k >= 0) (index as any[])[k] = entry; else index.push(entry);
  (index as any[]).sort((a, b) => a.n - b.n);
  fs.writeFileSync(`${outDir}/index.json`, JSON.stringify(index, null, 2));
}
await sim?.close();
