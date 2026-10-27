import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { startSim } from "../src/zetaris/sim-server.ts";
import { ZetarisClient, toObjects, ZetarisError } from "../src/zetaris/client.ts";
import { CaseMemory } from "../src/memory/caseMemory.ts";

const sim = await startSim(0, "test-key");
afterAll(() => sim.close());

describe("Zetaris REST contract (against zetaris-sim)", () => {
  const z = new ZetarisClient({ baseUrl: sim.url, apiKey: "test-key", orgId: "1" });
  it("runs SQL over the trustdesk container views", async () => {
    const r = await z.run("SELECT agent_name, kyb_status FROM trustdesk.vendor_registry ORDER BY agent_name");
    expect(r.engine).toBe("zetaris-sim");
    expect(toObjects(r).map((x) => x.agent_name)).toEqual(["FakeBot", "GoodBot", "SybilBot"]);
  });
  it("federated join across sources", async () => {
    const r = await z.run("SELECT i.ticket_id, v.kyb_status FROM trustdesk.incidents i JOIN trustdesk.vendor_registry v ON v.agent_name = i.agent_name WHERE i.severity = 'high'");
    expect(r.rows.length).toBe(2);
  });
  it("lists datasources", async () => { expect(JSON.stringify(await z.datasources())).toMatch(/vendor_registry/); });
  it("rejects writes and bad auth", async () => {
    await expect(z.run("DELETE FROM trustdesk.incidents")).rejects.toBeInstanceOf(ZetarisError);
    await expect(new ZetarisClient({ baseUrl: sim.url, apiKey: "nope", orgId: "1" }).run("SELECT 1")).rejects.toBeInstanceOf(ZetarisError);
  });
});

describe("case memory on H-MEM", () => {
  it("recalls and supersedes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmem-"));
    let t = 1_700_000_000_000; const m = new CaseMemory(dir, () => (t += 1000));
    const a = m.remember({ caseId: "c1", agentName: "SybilBot", officialAgentId: 2206, action: "issue refunds", verdict: "DENY", headline: "inflated reputation", keyFacts: ["raw 4.00 vs weighted 1.22"] });
    expect(a.superseded).toBeNull();
    expect(m.recall("SybilBot refunds").memories[0].id).toBe(a.record.id);
    const b = m.remember({ caseId: "c2", agentName: "SybilBot", officialAgentId: 2206, action: "issue refunds", verdict: "DENY", headline: "still inflated", keyFacts: [] });
    expect(b.superseded).toBe(a.record.id);
    expect(m.hmem.store.get(a.record.id)?.supersededBy).toBe(b.record.id);
    const before = m.hmem.store.get(b.record.id)!.confidence;
    m.feedback(b.record.id, "helpful");
    expect(m.hmem.store.get(b.record.id)!.confidence).toBeGreaterThan(before);
  });
});
