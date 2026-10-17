/**
 * CreateOS Sandbox runner (server-only).
 *
 * Constraints this encodes (see docs/implementation-plan.md):
 *  - Free plan allows 1 concurrent sandbox and 10 creates/day, so ONE named sandbox is reused.
 *  - Egress is open by default; any rule switches it to allowlist-only. We lock it on every acquire.
 *  - `timeoutMs` on the SDK is an HTTP request timeout, not a process limit, so the real execution
 *    limit is GNU `timeout` inside the sandbox.
 *  - Generated code is uploaded as a file and never interpolated into a shell string.
 */
import { randomUUID } from "node:crypto";
import {
  createClient,
  CreateosSandboxAuthError,
  CreateosSandboxError,
  CreateosSandboxNotFoundError,
  CreateosSandboxPaymentRequiredError,
  CreateosSandboxPermissionError,
  CreateosSandboxRateLimitError,
  type CreateosSandboxClient,
  type Sandbox,
} from "@nodeops-createos/sandbox";

export const RUNNER_NAME = "recoverly-runner";
export const RUNNER_SHAPE = "s-1vcpu-1gb";
export const RUNNER_ROOTFS = "devbox:1";
const JOBS_ROOT = "/tmp/recoverly-jobs";
const IDLE_PAUSE_SECONDS = 900;
const MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * Any egress rule switches the sandbox from "allow all" to allowlist-only. A single rule pointing at
 * a closed loopback port therefore blocks all real outbound traffic. Verified by `npm run spike:sandbox`.
 */
export const EGRESS_DENY_ALL = ["127.0.0.1:9"];

export interface SandboxJobFile {
  /** Path relative to the job directory. No absolute paths, no "..". */
  path: string;
  content: string;
}

export type SandboxRunStatus = "ok" | "nonzero_exit" | "timeout" | "sandbox_error";

export interface SandboxRunResult {
  status: SandboxRunStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  execMs: number | null;
  sandboxId: string | null;
  /** Human-readable cause when status is "sandbox_error". Never contains credentials. */
  error?: string;
  /** API error code (technical-spec section 8) for sandbox infrastructure failures. */
  errorCode?: SandboxErrorCode;
}

export type SandboxErrorCode = "SANDBOX_UNAVAILABLE" | "SANDBOX_RATE_LIMITED" | "SANDBOX_OUT_OF_CREDIT";

export interface RunPythonOptions {
  files: SandboxJobFile[];
  /** Entry script, relative to the job directory. */
  entry: string;
  /** Hard execution limit enforced inside the sandbox. */
  timeoutSeconds?: number;
}

interface RunnerGlobals {
  __recoverlyClient?: CreateosSandboxClient;
  __recoverlySandbox?: Promise<Sandbox>;
  __recoverlyQueue?: Promise<unknown>;
}
// Module state lives on globalThis so Next.js hot reloads don't leak sandboxes (free plan: 10 creates/day).
const g = globalThis as unknown as RunnerGlobals;

/** Stripe Projects writes CREATEOS_PROJECT_*; the SDK natively reads CREATEOS_SANDBOX_*. Accept either. */
function resolveApiKey(): string | undefined {
  return process.env.CREATEOS_SANDBOX_API_KEY ?? process.env.CREATEOS_PROJECT_API_KEY;
}

function resolveBaseUrl(): string {
  // CREATEOS_PROJECT_API_URL is the NodeOps account API (api-createos.nodeops.network), NOT the
  // sandbox control plane — never pass it to the SDK. Sandbox plane: api.sb.createos.sh / api-eu.sb.createos.sh.
  return process.env.CREATEOS_SANDBOX_BASE_URL ?? "https://api-eu.sb.createos.sh";
}

export function sandboxConfigured(): boolean {
  return Boolean(resolveApiKey());
}

export function getClient(): CreateosSandboxClient {
  if (!sandboxConfigured()) {
    throw new CreateosSandboxError(
      "CreateOS API key is not set. Run `stripe projects add createos/project` and `stripe projects env --pull` (expects CREATEOS_SANDBOX_API_KEY or CREATEOS_PROJECT_API_KEY).",
    );
  }
  g.__recoverlyClient ??= createClient({
    apiKey: resolveApiKey(),
    baseUrl: resolveBaseUrl(),
  });
  return g.__recoverlyClient;
}

/** Finds the reusable sandbox by name (running or paused), resuming it if needed; otherwise creates it. */
async function acquireSandbox(): Promise<Sandbox> {
  const client = getClient();
  const existing = (await client.listSandboxes()).find(
    (s) => s.name === RUNNER_NAME && (s.status === "running" || s.status === "paused" || s.status === "pausing"),
  );

  let sandbox: Sandbox;
  if (existing) {
    sandbox = existing;
    if (sandbox.status === "pausing") await sandbox.waitUntilPaused();
    if (sandbox.status === "paused") {
      await sandbox.resume();
      await sandbox.waitUntilRunning({ timeoutMs: 60_000 });
    }
  } else {
    sandbox = await client.createSandbox({
      shape: RUNNER_SHAPE,
      rootfs: RUNNER_ROOTFS,
      name: RUNNER_NAME,
      egress: EGRESS_DENY_ALL,
      auto_pause_after_seconds: IDLE_PAUSE_SECONDS,
    });
  }

  // Re-assert the lockdown on every acquire, including reused sandboxes.
  await sandbox.setEgress(EGRESS_DENY_ALL);
  return sandbox;
}

export function getRunnerSandbox(): Promise<Sandbox> {
  g.__recoverlySandbox ??= acquireSandbox().catch((err) => {
    g.__recoverlySandbox = undefined; // do not cache failures
    throw err;
  });
  return g.__recoverlySandbox;
}

export function invalidateRunnerSandbox(): void {
  g.__recoverlySandbox = undefined;
}

/** Maps SDK failures to actionable, credential-free messages. */
export function describeSandboxError(err: unknown): string {
  if (err instanceof CreateosSandboxPaymentRequiredError) {
    return "CreateOS account is out of sandbox credit. Top up or change plan, then retry.";
  }
  if (err instanceof CreateosSandboxRateLimitError) {
    return `CreateOS rate limit or sandbox cap reached${err.retryAfterSeconds ? `; retry in ${err.retryAfterSeconds}s` : ""}. The free plan allows 1 concurrent sandbox and 10 creates per day.`;
  }
  if (err instanceof CreateosSandboxPermissionError) {
    return "CreateOS refused the request (quota or permission). The free plan allows 1 concurrent sandbox; an older sandbox may still exist.";
  }
  if (err instanceof CreateosSandboxAuthError) {
    return "CreateOS rejected the API key. Re-run `stripe projects env --pull` and check CREATEOS_PROJECT_API_KEY / CREATEOS_SANDBOX_API_KEY.";
  }
  if (err instanceof CreateosSandboxError) return `CreateOS sandbox error: ${err.message}`;
  return `Unexpected sandbox failure: ${err instanceof Error ? err.message : String(err)}`;
}

export function sandboxErrorCode(err: unknown): SandboxErrorCode {
  if (err instanceof CreateosSandboxPaymentRequiredError) return "SANDBOX_OUT_OF_CREDIT";
  if (err instanceof CreateosSandboxRateLimitError || err instanceof CreateosSandboxPermissionError) return "SANDBOX_RATE_LIMITED";
  return "SANDBOX_UNAVAILABLE";
}

function assertSafeRelativePath(p: string): void {
  if (!p || p.startsWith("/") || p.split("/").includes("..") || /[\0\n\r]/.test(p) || !/^[\w./-]+$/.test(p)) {
    throw new CreateosSandboxError(`Unsafe job file path: ${JSON.stringify(p)}`);
  }
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_BYTES ? `${s.slice(0, MAX_OUTPUT_BYTES)}\n…[truncated]` : s;
}

async function runOnce(sandbox: Sandbox, opts: RunPythonOptions): Promise<SandboxRunResult> {
  assertSafeRelativePath(opts.entry);
  opts.files.forEach((f) => assertSafeRelativePath(f.path));

  const limit = Math.max(1, Math.min(120, Math.floor(opts.timeoutSeconds ?? 30)));
  const jobDir = `${JOBS_ROOT}/${randomUUID()}`; // uuid + constant root: safe to interpolate

  try {
    await sandbox.runCommand("mkdir", ["-p", jobDir]);
    for (const f of opts.files) {
      const dest = `${jobDir}/${f.path}`;
      const parent = dest.slice(0, dest.lastIndexOf("/"));
      if (parent !== jobDir) await sandbox.runCommand("mkdir", ["-p", parent]);
      await sandbox.files.upload(dest, f.content);
    }

    // `timeout -k 2 N` exits 124 on timeout. `-s` skips user site-packages; the script dir stays on sys.path.
    const res = await sandbox.runCommand("bash", [
      "-c",
      `cd ${jobDir} && timeout -k 2 ${limit} python3 -s ${opts.entry}`,
    ]);
    const { stdout, stderr, exit_code, error } = res.result;

    if (error) {
      return { status: "sandbox_error", exitCode: null, stdout: "", stderr: "", execMs: res.exec_ms, sandboxId: sandbox.id, error, errorCode: "SANDBOX_UNAVAILABLE" };
    }
    return {
      status: exit_code === 0 ? "ok" : exit_code === 124 ? "timeout" : "nonzero_exit",
      exitCode: exit_code,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      execMs: res.exec_ms,
      sandboxId: sandbox.id,
    };
  } finally {
    await sandbox.runCommand("rm", ["-rf", jobDir]).catch(() => undefined);
  }
}

async function runPythonUnqueued(opts: RunPythonOptions): Promise<SandboxRunResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await runOnce(await getRunnerSandbox(), opts);
    } catch (err) {
      // Sandbox destroyed out from under us: forget it and reacquire once.
      if (err instanceof CreateosSandboxNotFoundError && attempt === 0) {
        invalidateRunnerSandbox();
        continue;
      }
      return {
        status: "sandbox_error",
        exitCode: null,
        stdout: "",
        stderr: "",
        execMs: null,
        sandboxId: null,
        error: describeSandboxError(err),
        errorCode: sandboxErrorCode(err),
      };
    }
  }
  // Unreachable, but keeps the return type total.
  return { status: "sandbox_error", exitCode: null, stdout: "", stderr: "", execMs: null, sandboxId: null, error: "Sandbox unavailable.", errorCode: "SANDBOX_UNAVAILABLE" };
}

/**
 * Runs a Python entry script inside the shared sandbox. Runs are serialized: the free-plan shape is
 * 1 vCPU, and concurrent jobs would only make timings unpredictable during a live demo.
 * Never throws; failures are returned as `status: "sandbox_error"`.
 */
export function runPython(opts: RunPythonOptions): Promise<SandboxRunResult> {
  const next = (g.__recoverlyQueue ?? Promise.resolve()).then(() => runPythonUnqueued(opts));
  g.__recoverlyQueue = next.catch(() => undefined);
  return next;
}
