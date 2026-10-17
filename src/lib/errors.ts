import type { ErrorCode } from "./domain/schemas";

/** Typed API error. Kept free of Next.js imports so domain code and tests can use it directly. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown[],
    readonly extraHeaders?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
