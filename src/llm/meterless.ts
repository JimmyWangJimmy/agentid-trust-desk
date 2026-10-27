// Meterless Runtime provider (Meterless Runtime 1.4, provider contract v4).
// - id "meterless", name "Meterless Runtime", default base http://127.0.0.1:8088/v1
// - pasted URLs normalised to <host>/v1 (never /v1/v1); connect links http://h:p/connect#k=<key>
// - Authorization: Bearer <token> on every call; placeholder "rt-local" rejected
// - meterless-app header on every request, meterless-scope: user on chat
// - model ids are routing modes: meterless/<disposition|class|class.disposition>
// - GET /v1/models decides state: 401/403 unauthorized, 200 + meterless ids online, else offline
// - Auto Detect: ports 8088, 8090, 8787, 11434 on 127.0.0.1, localhost, [::1]
// - 180 s timeout for chat
import { openAiChat } from "./openaiCompat.ts";
import type { ChatRequest, ChatResult, Provider } from "./types.ts";

export const METERLESS_PROVIDER = { id: "meterless", name: "Meterless Runtime", defaultBaseUrl: "http://127.0.0.1:8088/v1" } as const;
export const METERLESS_APP_ID = "agentid-trust-desk";
export const TOKEN_STORAGE_KEY = "meterless_runtime_token";
export const CHAT_TIMEOUT_MS = 180_000;
export const DETECT_PORTS = [8088, 8090, 8787, 11434];
export const DETECT_HOSTS = ["127.0.0.1", "localhost", "[::1]"];
export const DISPOSITIONS = ["auto", "fast", "deep", "cheap", "local", "fusion"] as const;

export type RuntimeState = "online" | "unauthorized" | "offline";

export function normalizeBaseUrl(input: string): string {
  let s = input.trim();
  if (!s) return METERLESS_PROVIDER.defaultBaseUrl;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}/v1`;   // drops /v1, /v1/chat/completions, /v1/models, /healthz, /connect...
}

export function parseConnectLink(link: string): { baseUrl: string; token: string } | null {
  try {
    const u = new URL(link.trim());
    if (!/\/connect\/?$/.test(u.pathname)) return null;
    const k = new URLSearchParams(u.hash.replace(/^#/, "")).get("k");
    if (!k) return null;
    return { baseUrl: `${u.protocol}//${u.host}/v1`, token: k };
  } catch { return null; }
}

export function validateToken(token: string | undefined): string {
  const t = (token ?? "").trim();
  if (!t) throw new Error(`Meterless Runtime token missing (store it under ${TOKEN_STORAGE_KEY} / METERLESS_RUNTIME_TOKEN)`);
  if (t === "rt-local") throw new Error("The placeholder token rt-local is rejected; paste the real token from <stateDir>/proxy-token");
  return t;
}

export function isMeterlessModelId(id: string): boolean { return /^meterless\/[a-z0-9._-]+$/i.test(id); }

export function baseHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "meterless-app": METERLESS_APP_ID };
}

export async function probe(baseUrl: string, token: string, timeoutMs = 3000): Promise<{ state: RuntimeState; models: string[]; status?: number }> {
  try {
    const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, { headers: baseHeaders(token), signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 401 || res.status === 403) return { state: "unauthorized", models: [], status: res.status };
    if (res.status !== 200) return { state: "offline", models: [], status: res.status };
    const j: any = await res.json().catch(() => null);
    const models: string[] = (j?.data ?? []).map((m: any) => String(m.id)).filter(isMeterlessModelId); // keep unknown meterless/* ids
    return { state: models.length ? "online" : "offline", models, status: 200 };
  } catch { return { state: "offline", models: [] }; }
}

export async function autoDetect(token: string): Promise<{ baseUrl: string; state: RuntimeState; models: string[] } | null> {
  for (const port of DETECT_PORTS) for (const host of DETECT_HOSTS) {
    const baseUrl = `http://${host}:${port}/v1`;
    const p = await probe(baseUrl, token, 1500);
    if (p.state === "online" || p.state === "unauthorized") return { baseUrl, ...p };
  }
  return null;
}

export class MeterlessProvider implements Provider {
  readonly id = METERLESS_PROVIDER.id;
  readonly baseUrl: string;
  readonly model: string;
  private token: string;

  constructor(opts: { baseUrl?: string; token?: string; model?: string; connectLink?: string } = {}) {
    const link = opts.connectLink ?? process.env.METERLESS_CONNECT_LINK;
    const fromLink = link ? parseConnectLink(link) : null;
    this.baseUrl = normalizeBaseUrl(fromLink?.baseUrl ?? opts.baseUrl ?? process.env.METERLESS_BASE_URL ?? METERLESS_PROVIDER.defaultBaseUrl);
    this.token = validateToken(fromLink?.token ?? opts.token ?? process.env.METERLESS_RUNTIME_TOKEN);
    this.model = opts.model ?? process.env.METERLESS_MODEL ?? "meterless/auto";
  }

  status() { return probe(this.baseUrl, this.token); }

  chat(req: ChatRequest): Promise<ChatResult> {
    return openAiChat({
      provider: this.id, baseUrl: this.baseUrl, model: req.model ?? this.model, req, timeoutMs: CHAT_TIMEOUT_MS,
      headers: { ...baseHeaders(this.token), "meterless-scope": "user" },
    });
  }
}
