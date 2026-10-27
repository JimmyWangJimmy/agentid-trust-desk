import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { normalizeBaseUrl, parseConnectLink, validateToken, isMeterlessModelId, probe, MeterlessProvider, METERLESS_PROVIDER } from "../src/llm/meterless.ts";
import { ProviderRouter } from "../src/llm/router.ts";
import { TransportError, ProviderHttpError, type Provider, type ChatResult } from "../src/llm/types.ts";

// A stub that speaks the Meterless Runtime contract, used to test the client.
const seen: http.IncomingHttpHeaders[] = [];
const stub = http.createServer((req, res) => {
  seen.push(req.headers);
  if (req.headers.authorization !== "Bearer good") { res.writeHead(401).end(); return; }
  if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "meterless/auto" }, { id: "meterless/deep" }, { id: "meterless/new-mode" }] })); return; }
  if (req.url === "/v1/chat/completions") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ model: "meterless/auto", choices: [{ message: { role: "assistant", content: "pong" } }], usage: {} })); return; }
  res.writeHead(404).end();
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
afterAll(() => stub.close());

describe("Meterless Runtime provider contract v4", () => {
  it("identity", () => { expect(METERLESS_PROVIDER).toEqual({ id: "meterless", name: "Meterless Runtime", defaultBaseUrl: "http://127.0.0.1:8088/v1" }); });
  it("normalizes any pasted URL to <host>/v1", () => {
    expect(normalizeBaseUrl("127.0.0.1:8088")).toBe("http://127.0.0.1:8088/v1");
    expect(normalizeBaseUrl("http://localhost:8090/v1/chat/completions")).toBe("http://localhost:8090/v1");
    expect(normalizeBaseUrl("http://[::1]:8787/healthz")).toBe("http://[::1]:8787/v1");
    expect(normalizeBaseUrl("")).toBe("http://127.0.0.1:8088/v1");
  });
  it("parses connect links", () => {
    expect(parseConnectLink("http://127.0.0.1:8088/connect#k=abc123")).toEqual({ baseUrl: "http://127.0.0.1:8088/v1", token: "abc123" });
    expect(parseConnectLink("http://127.0.0.1:8088/v1#k=abc")).toBeNull();
  });
  it("rejects missing and rt-local tokens", () => {
    expect(() => validateToken("")).toThrow(/missing/);
    expect(() => validateToken("rt-local")).toThrow(/rt-local/);
    expect(validateToken(" tok ")).toBe("tok");
  });
  it("recognises routing-mode model ids, including unknown future ones", () => {
    expect(isMeterlessModelId("meterless/new-mode")).toBe(true);
    expect(isMeterlessModelId("gpt-4o")).toBe(false);
  });
  it("probe: online / unauthorized / offline", async () => {
    const on = await probe(`${base}/v1`, "good");
    expect(on.state).toBe("online"); expect(on.models).toContain("meterless/new-mode");
    expect((await probe(`${base}/v1`, "bad")).state).toBe("unauthorized");
    expect((await probe("http://127.0.0.1:1/v1", "good", 500)).state).toBe("offline");
  });
  it("chat sends meterless-app on every request and meterless-scope: user on chat", async () => {
    seen.length = 0;
    const p = new MeterlessProvider({ baseUrl: base, token: "good" });
    const r = await p.chat({ messages: [{ role: "user", content: "ping" }] });
    expect(r.content).toBe("pong");
    expect(seen[0]["meterless-app"]).toBe("agentid-trust-desk");
    expect(seen[0]["meterless-scope"]).toBe("user");
    await probe(`${base}/v1`, "good");
    expect(seen[1]["meterless-app"]).toBe("agentid-trust-desk");
    expect(seen[1]["meterless-scope"]).toBeUndefined();
  });
});

const ok = (provider: string): ChatResult => ({ provider, model: "m", content: "ok", reasoning: null, toolCalls: [], usage: {}, ms: 1 });
const P = (id: string, f: () => Promise<ChatResult>): Provider => ({ id, chat: f });

describe("router: fall back only on transport failure", () => {
  it("uses Meterless when it answers", async () => {
    const r = new ProviderRouter(P("meterless", async () => ok("meterless")), P("nvidia", async () => ok("nvidia")));
    expect((await r.chat({ messages: [] })).provider).toBe("meterless");
    expect(r.events[0].event).toBe("primary_ok");
  });
  it("falls back on TransportError", async () => {
    const r = new ProviderRouter(P("meterless", async () => { throw new TransportError("ECONNREFUSED"); }), P("nvidia", async () => ok("nvidia")));
    expect((await r.chat({ messages: [] })).provider).toBe("nvidia");
    expect(r.events[0].event).toBe("fallback");
  });
  it("does NOT fall back on an HTTP error from Meterless", async () => {
    const r = new ProviderRouter(P("meterless", async () => { throw new ProviderHttpError("401", 401); }), P("nvidia", async () => ok("nvidia")));
    await expect(r.chat({ messages: [] })).rejects.toBeInstanceOf(ProviderHttpError);
  });
  it("real MeterlessProvider against a closed port is a transport failure -> fallback", async () => {
    const r = new ProviderRouter(new MeterlessProvider({ baseUrl: "http://127.0.0.1:1", token: "x" }), P("nvidia", async () => ok("nvidia")));
    expect((await r.chat({ messages: [] })).provider).toBe("nvidia");
  });
});
