// Smoke-test whatever Zetaris endpoint ZETARIS_REST_URL points at (real Zetaris or zetaris-sim).
import { loadEnv } from "../src/env.ts";
import { ZetarisClient, toObjects } from "../src/zetaris/client.ts";
loadEnv();
const z = new ZetarisClient();
console.log(`Zetaris REST: ${z.base}`);
if (process.argv.includes("--apply")) {
  // Create the Lightning REST tables + schemastore views on a REAL Zetaris instance (idempotency is up to Zetaris).
  const fs = await import("node:fs");
  const stmts = fs.readFileSync("sql/zetaris/01_trustdesk_create.sql", "utf-8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
  for (const sql of stmts) {
    try { await z.run(sql, { limit: 1 }); console.log(`ok   ${sql.split("\n")[0].slice(0, 90)}`); }
    catch (e: any) { console.log(`FAIL ${sql.split("\n")[0].slice(0, 90)}\n     ${e.message}`); }
  }
}
for (const sql of [
  "SELECT agent_name, kyb_status, declared_owner_wallet FROM trustdesk.vendor_registry",
  "SELECT agent_name, count(*) AS n FROM trustdesk.incidents GROUP BY agent_name",
  "SELECT name, agent_uri FROM trustdesk.agent_cards",
]) {
  const r = await z.run(sql, { limit: 20 });
  console.log(`\n${sql}\n  engine=${r.engine} ${r.ms}ms`); console.table(toObjects(r));
}
