// Usage:
//   npm run investigate -- --agent SybilBot --action "issue customer refunds up to $500" [--sim] [--out runs]
//   npm run investigate -- feedback <memoryId> helpful|not_helpful|wrong
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./env.ts";
import { investigate } from "./agent/investigator.ts";
import { printReport } from "./report.ts";
import { CaseMemory } from "./memory/caseMemory.ts";
import { autoDetect } from "./llm/meterless.ts";

loadEnv();
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

if (argv[0] === "feedback") {
  const mem = new CaseMemory();
  const rec = mem.feedback(argv[1], argv[2] as any);
  console.log(JSON.stringify({ id: rec?.id, confidence: rec?.confidence, history: mem.history(argv[1]).map((h) => `${h.action}@${new Date(h.timestamp).toISOString()}`) }, null, 2));
  process.exit(0);
}

const agentName = flag("agent") ?? "SybilBot";
const action = flag("action") ?? "issue customer refunds up to $500";
let sim: { close: () => Promise<void>; url: string } | undefined;
if (argv.includes("--sim")) {
  const { startSim } = await import("./zetaris/sim-server.ts");
  process.env.ZETARIS_API_KEY ??= "sim-local-key";
  sim = await startSim(Number(process.env.ZETARIS_SIM_PORT ?? 8899), process.env.ZETARIS_API_KEY);
  process.env.ZETARIS_REST_URL = sim.url;
  console.log(`[zetaris] using LOCAL SIMULATOR at ${sim.url} (same REST contract as Zetaris; engine=zetaris-sim)`);
}
const detected = await autoDetect(process.env.METERLESS_RUNTIME_TOKEN || "probe");
console.log(`[meterless] auto-detect: ${detected ? `${detected.state} at ${detected.baseUrl}` : "no Meterless Runtime on 127.0.0.1/localhost/[::1] ports 8088/8090/8787/11434"}`);
if (detected?.state === "online" && !process.env.METERLESS_BASE_URL) process.env.METERLESS_BASE_URL = detected.baseUrl;

const quiet = argv.includes("--quiet");
const report = await investigate({
  agentName, action,
  onStep: (s) => { if (!quiet && s.type !== "reasoning") console.log(`  · ${s.type}${s.tool ? ` ${s.tool}` : ""}${s.args ? ` ${JSON.stringify(s.args)}` : ""}`); },
});
(report.environment as any).meterlessDetect = detected ?? "not found";
printReport(report);
const outDir = flag("out") ?? "runs";
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${report.caseId}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`trace written to ${file}`);
await sim?.close();
