import { ProviderHttpError, TransportError, type ChatRequest, type ChatResult } from "./types.ts";

export async function openAiChat(opts: {
  provider: string; baseUrl: string; headers: Record<string, string>; model: string; req: ChatRequest; timeoutMs: number;
}): Promise<ChatResult> {
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.req.messages,
    temperature: opts.req.temperature ?? 0.2,
    max_tokens: opts.req.maxTokens ?? 1500,
  };
  if (opts.req.tools?.length) { body.tools = opts.req.tools; body.tool_choice = "auto"; }
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e: any) {
    throw new TransportError(`${opts.provider} unreachable at ${opts.baseUrl}: ${e?.cause?.code ?? e?.name ?? e}`, e);
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderHttpError(`${opts.provider} HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  const j = JSON.parse(text);
  const m = j.choices?.[0]?.message ?? {};
  return {
    provider: opts.provider, model: j.model ?? opts.model,
    content: m.content ?? null, reasoning: m.reasoning_content ?? m.reasoning ?? null,
    toolCalls: m.tool_calls ?? [], usage: j.usage, ms: Date.now() - t0,
  };
}
