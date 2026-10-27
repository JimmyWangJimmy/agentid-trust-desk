export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ToolSpec { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ChatResult {
  provider: string;        // "meterless" | "nvidia"
  model: string;
  content: string | null;
  reasoning: string | null; // reasoning_content when the model exposes it
  toolCalls: ToolCall[];
  usage?: Record<string, unknown>;
  ms: number;
}
export interface ChatRequest { messages: ChatMessage[]; tools?: ToolSpec[]; temperature?: number; maxTokens?: number; model?: string }
export interface Provider { id: string; chat(req: ChatRequest): Promise<ChatResult> }

/** Thrown when the provider could not be reached at all (DNS, refused, timeout, reset). */
export class TransportError extends Error { constructor(msg: string, readonly cause?: unknown) { super(msg); } }
/** Thrown when the provider answered with an error status. Never triggers fallback. */
export class ProviderHttpError extends Error { constructor(msg: string, readonly status: number) { super(msg); } }
