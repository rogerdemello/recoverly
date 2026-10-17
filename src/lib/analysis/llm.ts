import OpenAI from "openai";

const DEFAULT_MODEL = process.env.RECOVERLY_MODEL || "openai/gpt-4o-mini";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Run `stripe projects add OpenRouter/api` and `stripe projects env --pull`.");
  }
  client ??= new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
  return client;
}

export async function chatJSON<T>(system: string, user: string, opts?: { retries?: number }): Promise<T> {
  const openai = getClient();
  const retries = opts?.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const raw = res.choices[0]?.message?.content ?? "";
      return JSON.parse(raw) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function chatText(system: string, user: string): Promise<string> {
  const openai = getClient();
  const res = await openai.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0.2,
    max_tokens: 2500,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

export { DEFAULT_MODEL };
