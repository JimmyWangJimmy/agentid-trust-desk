// NVIDIA API Catalog (integrate.api.nvidia.com), OpenAI-compatible. Nemotron models.
import { openAiChat } from "./openaiCompat.ts";
import type { ChatRequest, ChatResult, Provider } from "./types.ts";

export class NvidiaProvider implements Provider {
  readonly id = "nvidia";
  readonly baseUrl: string;
  readonly model: string;
  private key: string;
  constructor(opts: { baseUrl?: string; apiKey?: string; model?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
    const k = opts.apiKey ?? process.env.NVIDIA_API_KEY;
    if (!k) throw new Error("NVIDIA_API_KEY not set");
    this.key = k;
    this.model = opts.model ?? process.env.NVIDIA_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b";
  }
  chat(req: ChatRequest): Promise<ChatResult> {
    // Only Nemotron/NVIDIA ids are valid here; a meterless/* routing id is replaced by this provider's model.
    const model = req.model && !req.model.startsWith("meterless/") ? req.model : this.model;
    return openAiChat({ provider: this.id, baseUrl: this.baseUrl, model, req: { ...req, model }, timeoutMs: 180_000, headers: { Authorization: `Bearer ${this.key}` } });
  }
}
