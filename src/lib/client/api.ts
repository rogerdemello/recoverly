/** Browser-side API helpers: JSON calls with the optional access code, and an SSE reader over fetch. */
import type { ApiErrorBody } from "../domain/schemas";

export class ApiCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown[],
  ) {
    super(message);
  }
}

function headers(accessCode: string, json = true): HeadersInit {
  return { ...(json ? { "content-type": "application/json" } : {}), ...(accessCode ? { "x-access-code": accessCode } : {}) };
}

async function toError(res: Response): Promise<ApiCallError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiCallError(body.error.code, body.error.message, res.status, body.error.details);
  } catch {
    return new ApiCallError("BAD_REQUEST", `Request failed (HTTP ${res.status}).`, res.status);
  }
}

export async function postJson<T>(url: string, body: unknown, accessCode: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: headers(accessCode), body: JSON.stringify(body) });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function getJson<T>(url: string, accessCode: string): Promise<T> {
  const res = await fetch(url, { headers: headers(accessCode, false), cache: "no-store" });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function uploadCsv<T>(file: File, accessCode: string): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/data/load", { method: "POST", headers: headers(accessCode, false), body: form });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/** POSTs and reads a text/event-stream response, invoking onEvent for each event. */
export async function streamSse(
  url: string,
  body: unknown,
  accessCode: string,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: headers(accessCode), body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) throw await toError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) {
        try {
          onEvent(event, JSON.parse(dataLines.join("\n")));
        } catch {
          /* ignore a malformed event rather than crash the stream */
        }
      }
    }
  }
}
