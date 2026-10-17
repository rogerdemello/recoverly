/** Shared HTTP helpers for route handlers: error envelope, access code, rate limit. */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { ApiErrorBody, ErrorCode } from "./domain/schemas";
import { ApiError } from "./errors";
import { rateLimit } from "./store";

export { ApiError };

const STATUS: Record<ErrorCode, number> = {
  CSV_INVALID: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  DATASET_NOT_FOUND: 404,
  ANALYSIS_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  UNSUPPORTED_REQUEST: 422,
  LLM_UNAVAILABLE: 502,
  GENERATION_FAILED: 502,
  SANDBOX_UNAVAILABLE: 502,
  SANDBOX_RATE_LIMITED: 429,
  SANDBOX_OUT_OF_CREDIT: 402,
  SANDBOX_TIMEOUT: 504,
  SANDBOX_EXEC_FAILED: 502,
  RESULT_INVALID: 502,
  DRAFT_NOT_ELIGIBLE: 409,
  APPROVAL_INVALID: 403,
  SEND_FAILED: 502,
  RATE_LIMITED: 429,
};

export function statusFor(code: ErrorCode): number {
  return STATUS[code];
}

export function errorBody(code: ErrorCode, message: string, details?: unknown[]): ApiErrorBody {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(errorBody(err.code, err.message, err.details), {
      status: STATUS[err.code],
      headers: err.extraHeaders,
    });
  }
  // Never leak internals or secrets in an unexpected error.
  console.error("[api] unexpected error:", err instanceof Error ? err.name : "unknown");
  return NextResponse.json(errorBody("BAD_REQUEST", "Unexpected server error."), { status: 500 });
}

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}

/** Optional shared passcode for the public demo (RECOVERLY_ACCESS_CODE). */
export function requireAccess(req: Request): void {
  const expected = process.env.RECOVERLY_ACCESS_CODE;
  if (!expected) return;
  const given = req.headers.get("x-access-code") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError("UNAUTHORIZED", "An access code is required for this demo (header x-access-code).");
  }
}

export function enforceAnalysisRateLimit(req: Request): void {
  const retry = rateLimit(`analyze:${clientKey(req)}`, 20, 60 * 60 * 1000);
  if (retry !== null) {
    throw new ApiError("RATE_LIMITED", `Too many analyses. Try again in ${retry}s.`, undefined, { "retry-after": String(retry) });
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new ApiError("BAD_REQUEST", "Expected a JSON object body.");
}
