// Zetaris REST client, following the documented hackathon contract
// (zetaris/getting-started scripts/zetaris_sql.py RestChannel):
//   POST {ZETARIS_REST_URL}/sql-editor/sqls/run
//   headers: Authorization: Bearer <key>, X-Org-ID, X-Request-ID
//   body: {queryId, sql, source: "SqlEditor", limit}  -> response.data = rows
import { randomUUID } from "node:crypto";

export class ZetarisError extends Error {}

export interface ZetarisResult {
  sql: string;
  columns: string[];
  rows: unknown[][];
  queryId: string;
  endpoint: string;
  engine: string;   // "zetaris" (real instance) or "zetaris-sim" (local simulator)
  ms: number;
}

export class ZetarisClient {
  readonly base: string;
  readonly org: string;
  private key: string;

  constructor(opts: { baseUrl?: string; orgId?: string; apiKey?: string } = {}) {
    this.base = (opts.baseUrl ?? process.env.ZETARIS_REST_URL ?? "http://localhost:8888/api/v1.0").replace(/\/+$/, "");
    this.org = opts.orgId ?? process.env.ZETARIS_ORG_ID ?? "1";
    const key = opts.apiKey ?? process.env.ZETARIS_API_KEY;
    if (!key) throw new ZetarisError("ZETARIS_API_KEY is not set");
    this.key = key;
  }

  private async call(path: string, body?: unknown, timeoutMs = 600_000): Promise<any> {
    const res = await fetch(this.base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "X-Org-ID": this.org,
        "X-Request-ID": randomUUID(),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((e) => { throw new ZetarisError(`Cannot reach ${this.base}: ${e?.cause?.code ?? e?.message ?? e}`); });
    const text = await res.text();
    if (!res.ok) throw new ZetarisError(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  datasources(): Promise<unknown> {
    return this.call("/datasource/datasources");
  }

  /** Run one SQL statement. `columns` lets callers name positional rows when the server returns arrays only. */
  async run(sql: string, opts: { limit?: number; columns?: string[] } = {}): Promise<ZetarisResult> {
    const queryId = randomUUID();
    const t0 = Date.now();
    const out = await this.call("/sql-editor/sqls/run", { queryId, sql, source: "SqlEditor", limit: opts.limit ?? 100 });
    const data = (out && typeof out === "object" ? out.data : null) ?? [];
    let columns: string[] = Array.isArray(out?.columns) ? out.columns.map(String) : opts.columns ?? [];
    let rows: unknown[][];
    if (data.length && !Array.isArray(data[0]) && typeof data[0] === "object") {
      columns = columns.length ? columns : Object.keys(data[0]);
      rows = data.map((r: Record<string, unknown>) => columns.map((c) => r[c]));
    } else rows = data as unknown[][];
    return { sql, columns, rows, queryId, endpoint: this.base, engine: out?.engine ?? "zetaris", ms: Date.now() - t0 };
  }
}

export function toObjects(r: ZetarisResult): Record<string, unknown>[] {
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
}
