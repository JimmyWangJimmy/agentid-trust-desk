// zetaris-sim: a LOCAL STAND-IN for a Zetaris instance, for machines that
// cannot run the 8 GB Zetaris Docker bundle. It exposes the same REST
// contract (POST /api/v1.0/sql-editor/sqls/run, Bearer + X-Org-ID) and the
// same container.view names that sql/zetaris/01_trustdesk_create.sql creates
// on real Zetaris, backed by SQLite (sql.js). Responses carry engine:"zetaris-sim"
// so nothing downstream can mistake a simulated answer for a real Zetaris one.
// It is read-only: only SELECT / WITH statements are accepted.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type Database } from "sql.js";
import { SOURCES, AGENT_CARD_SOURCES, CONTAINER } from "./sources.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function buildSimDb(opts: { offlineCards?: boolean } = {}): Promise<Database> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`ATTACH DATABASE ':memory:' AS ${CONTAINER}`);
  const insert = (table: string, cols: string[], recs: Record<string, unknown>[]) => {
    db.run(`CREATE TABLE ${CONTAINER}.${table} (${cols.map((c) => `"${c}"`).join(", ")})`);
    const stmt = db.prepare(`INSERT INTO ${CONTAINER}.${table} VALUES (${cols.map(() => "?").join(", ")})`);
    for (const r of recs) stmt.run(cols.map((c) => { const v = r[c]; return typeof v === "boolean" ? (v ? 1 : 0) : (v as any) ?? null; }));
    stmt.free();
  };
  for (const s of SOURCES) {
    const file = path.join(root, s.localFile!);
    const recs = JSON.parse(fs.readFileSync(file, "utf-8")).records as Record<string, unknown>[];
    insert(s.view, s.columns.map((c) => c.name), recs);
  }
  // agent_cards: fetched live from the public agentURI, like a Zetaris REST table; cached copy if offline.
  const cacheFile = path.join(root, "data", "cache", "agent_cards.json");
  let cards: Record<string, unknown>[] = [];
  if (!opts.offlineCards) {
    try {
      cards = await Promise.all(AGENT_CARD_SOURCES.map(async (c) => {
        const j = await (await fetch(c.endpoint, { signal: AbortSignal.timeout(15_000) })).json();
        return { name: j.name, description: j.description, active: j.active, x402_support: j.x402Support, agent_uri: c.endpoint };
      }));
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cards, null, 2));
    } catch { cards = []; }
  }
  if (!cards.length && fs.existsSync(cacheFile)) cards = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  insert("agent_cards", ["name", "description", "active", "x402_support", "agent_uri"], cards);
  return db;
}

export function runSql(db: Database, sql: string, limit = 100): { columns: string[]; rows: unknown[][] } {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(trimmed) || /;/.test(trimmed)) throw new Error("zetaris-sim is read-only: one SELECT/WITH statement per request");
  const res = db.exec(trimmed);
  if (!res.length) return { columns: [], rows: [] };
  return { columns: res[0].columns, rows: res[0].values.slice(0, limit) };
}

export async function startSim(port = Number(process.env.ZETARIS_SIM_PORT ?? 8899), apiKey = process.env.ZETARIS_API_KEY ?? "sim-local-key") {
  const db = await buildSimDb();
  const server = http.createServer(async (req, res) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: "unauthorized" });
    if (!req.headers["x-org-id"]) return send(400, { error: "X-Org-ID header required" });
    if (req.method === "GET" && req.url === "/api/v1.0/datasource/datasources")
      return send(200, { engine: "zetaris-sim", data: [...SOURCES.map((s) => ({ container: CONTAINER, view: s.view, system: s.system, endpoint: s.endpoint })), ...AGENT_CARD_SOURCES.map((c) => ({ container: CONTAINER, view: "agent_cards", endpoint: c.endpoint }))] });
    if (req.method === "POST" && req.url === "/api/v1.0/sql-editor/sqls/run") {
      let raw = ""; for await (const ch of req) raw += ch;
      try {
        const body = JSON.parse(raw);
        const out = runSql(db, String(body.sql ?? ""), Number(body.limit ?? 100));
        return send(200, { engine: "zetaris-sim", queryId: body.queryId, ...out, data: out.rows });
      } catch (e: any) { return send(400, { engine: "zetaris-sim", error: String(e?.message ?? e) }); }
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const actual = (server.address() as import("node:net").AddressInfo).port;
  return { server, url: `http://127.0.0.1:${actual}/api/v1.0`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = await startSim();
  console.log(`zetaris-sim (LOCAL SIMULATOR, not real Zetaris) listening on ${s.url}`);
}
