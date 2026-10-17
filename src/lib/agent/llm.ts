/**
 * OpenAI-compatible chat client (default OpenRouter). Secrets are read from env only and never logged.
 * Tests inject a stub through `setLlmForTesting`.
 */
import OpenAI from "openai";

export interface Llm {
  /** Returns the raw reply text of a JSON-mode completion. */
  json(system: string, user: string, opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string>;
  /** Returns the raw reply text of a plain completion. */
  text(system: string, user: string, opts?: { maxTokens?: number; timeoutMs?: number }): Promise<string>;
}

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export const DEFAULT_MODEL = "openai/gpt-4o-mini";

export function llmModel(): string {
  return process.env.RECOVERLY_MODEL?.trim() || DEFAULT_MODEL;
}

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("The LLM provider is not configured (OPENROUTER_API_KEY is not set).");
  client ??= new OpenAI({
    apiKey,
    baseURL: process.env.RECOVERLY_LLM_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    maxRetries: 1,
  });
  return client;
}

function describe(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return "The LLM provider rejected the credentials.";
  if (status === 402) return "The LLM provider reports insufficient credit.";
  if (status === 429) return "The LLM provider is rate limiting requests.";
  if ((err as { name?: string })?.name === "APIUserAbortError") return "The LLM provider timed out.";
  return `The LLM provider failed${status ? ` (HTTP ${status})` : ""}.`;
}

async function completeOnce(system: string, user: string, jsonMode: boolean, maxTokens: number, timeoutMs: number): Promise<string> {
  const openai = getClient();
  const res = await openai.chat.completions.create(
    {
      model: llmModel(),
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { timeout: timeoutMs },
  );
  const text = res.choices[0]?.message?.content ?? "";
  if (!text.trim()) throw Object.assign(new Error("empty completion"), { name: "EmptyCompletion" });
  return text;
}

const NO_RETRY = new Set([400, 401, 402, 403, 404]);

/** One extra attempt for transient failures (network, 429, 5xx, empty reply); credential and credit errors fail fast. */
async function complete(system: string, user: string, jsonMode: boolean, maxTokens: number, timeoutMs: number): Promise<string> {
  getClient(); // surface a missing key immediately
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await completeOnce(system, user, jsonMode, maxTokens, timeoutMs);
    } catch (err) {
      lastError = err;
      // Log the failure class only: provider errors can echo request details, so never the message body or headers.
      const e = err as { name?: string; status?: number; code?: string; cause?: { code?: string } };
      console.error("[llm] request failed:", e.name, e.status ?? "", e.code ?? "", e.cause?.code ?? "");
      if (e.status !== undefined && NO_RETRY.has(e.status)) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw new LlmUnavailableError(describe(lastError));
}

const realLlm: Llm = {
  json: (system, user, opts) => complete(system, user, true, opts?.maxTokens ?? 800, opts?.timeoutMs ?? 45_000),
  text: (system, user, opts) => complete(system, user, false, opts?.maxTokens ?? 2000, opts?.timeoutMs ?? 60_000),
};

let override: Llm | null = null;

export function setLlmForTesting(llm: Llm | null): void {
  override = llm;
}

export function getLlm(): Llm {
  return override ?? realLlm;
}

/** Pulls the first JSON object out of a reply that may carry prose or fences (tolerant extraction). */
export function extractJsonObject(reply: string): unknown {
  const trimmed = reply.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    const candidate = fenced?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    return JSON.parse(candidate);
  }
}
