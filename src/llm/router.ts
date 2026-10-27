// Primary provider: Meterless Runtime. Fallback: NVIDIA Nemotron, ONLY on a
// transport failure (runtime not running / unreachable). An HTTP error from
// Meterless (401, 4xx, 5xx) is surfaced, never silently re-routed.
import { MeterlessProvider } from "./meterless.ts";
import { NvidiaProvider } from "./nvidia.ts";
import { TransportError, type ChatRequest, type ChatResult, type Provider } from "./types.ts";

export interface RouteEvent { at: string; provider: string; event: "primary_ok" | "fallback" | "primary_unconfigured"; detail?: string }

export class ProviderRouter implements Provider {
  readonly id = "router";
  readonly events: RouteEvent[] = [];
  constructor(private primary: Provider | null, private fallbackProvider: Provider | null, private primaryConfigError?: string) {}

  static fromEnv(): ProviderRouter {
    let primary: Provider | null = null; let err: string | undefined;
    try { primary = new MeterlessProvider(); } catch (e: any) { err = e.message; }
    let fb: Provider | null = null;
    try { fb = new NvidiaProvider(); } catch { fb = null; }
    return new ProviderRouter(primary, fb, err);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const at = new Date().toISOString();
    if (this.primary) {
      try {
        const r = await this.primary.chat(req);
        this.events.push({ at, provider: this.primary.id, event: "primary_ok" });
        return r;
      } catch (e) {
        if (!(e instanceof TransportError) || !this.fallbackProvider) throw e;
        this.events.push({ at, provider: this.fallbackProvider.id, event: "fallback", detail: e.message });
        return this.fallbackProvider.chat(req);
      }
    }
    // Meterless not configured at all (no token): treat as transport-unavailable, but record it loudly.
    if (!this.fallbackProvider) throw new Error(`No LLM provider: ${this.primaryConfigError}`);
    this.events.push({ at, provider: this.fallbackProvider.id, event: "primary_unconfigured", detail: this.primaryConfigError });
    return this.fallbackProvider.chat(req);
  }
}
