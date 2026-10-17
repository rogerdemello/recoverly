/**
 * The agent pipeline (technical-spec 5.1): plan -> codegen -> guard -> sandbox -> validate,
 * with one regeneration on failure. Emits SSE-shaped events; never returns an unvalidated result.
 */
import { toSandboxData } from "../domain/csv";
import { DEMO_PLAN, type AnalysisPlan, type AnalysisResult, type ErrorCode } from "../domain/schemas";
import { runPython as realRunPython, type SandboxRunResult } from "../sandbox/runner";
import type { Dataset } from "../store";
import { generateCode, loadLibSource, loadReplayScript } from "./codegen";
import { guardGeneratedCode } from "./guard";
import { LlmUnavailableError } from "./llm";
import { planQuestion, PlannerError } from "./plan";
import { validateResult } from "./validate";

export type PipelineEmit = (event: string, data: unknown) => void;
export type RunPythonFn = typeof realRunPython;

export interface AttemptSummary {
  attempt: number;
  stage: "codegen" | "guard" | "sandbox" | "validate";
  status: string;
  message: string;
}

export type PipelineOutcome =
  | { ok: true; analysisId: string; plan: AnalysisPlan; result: AnalysisResult }
  | { ok: false; code: ErrorCode; message: string; details?: unknown[] };

export interface PipelineInput {
  dataset: Dataset;
  question: string;
  analysisId: string;
  replay?: boolean;
  emit: PipelineEmit;
  runPython?: RunPythonFn;
}

const SANDBOX_TIMEOUT_SECONDS = 20;

function stderrTail(stderr: string): string {
  return stderr.length > 2048 ? stderr.slice(-2048) : stderr;
}

function failureText(a: AttemptSummary): string {
  return `${a.stage} failed (${a.status}): ${a.message}`.slice(0, 2400);
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutcome> {
  const { dataset, question, analysisId, emit } = input;
  const runPython = input.runPython ?? realRunPython;
  const replay = Boolean(input.replay);

  // 1. Plan (replay skips the LLM entirely and uses the canonical demo plan)
  let plan: AnalysisPlan;
  if (replay) {
    plan = DEMO_PLAN;
  } else {
    try {
      const currencies: string[] = [];
      const codes: string[] = [];
      for (const r of dataset.records) {
        if (!currencies.includes(r.currency)) currencies.push(r.currency);
        if (!codes.includes(r.failure_code)) codes.push(r.failure_code);
      }
      plan = await planQuestion(question, { asOf: dataset.asOf, rows: dataset.records.length, currencies, failureCodes: codes });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Planning failed.";
      if (err instanceof PlannerError && err.kind === "invalid") return { ok: false, code: "UNSUPPORTED_REQUEST", message };
      return { ok: false, code: "LLM_UNAVAILABLE", message };
    }
  }
  emit("plan", { analysisId, plan, source: replay ? "replay" : "generated" });

  if (plan.intent === "unsupported") {
    return {
      ok: false,
      code: "UNSUPPORTED_REQUEST",
      message: plan.unsupported_reason ?? "This request is not supported.",
    };
  }

  const dataJson = JSON.stringify(toSandboxData(dataset.asOf, dataset.records));
  const lib = loadLibSource();
  const attempts: AttemptSummary[] = [];
  const maxAttempts = replay ? 1 : 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const previous = attempts.length ? failureText(attempts[attempts.length - 1]!) : undefined;

    // 2. Codegen
    let code: string;
    if (replay) {
      code = loadReplayScript();
    } else {
      try {
        const generated = await generateCode(plan, previous);
        if (!generated.ok) {
          attempts.push({ attempt, stage: "codegen", status: "no_code", message: generated.message });
          continue;
        }
        code = generated.code;
      } catch (err) {
        if (err instanceof LlmUnavailableError) return { ok: false, code: "LLM_UNAVAILABLE", message: err.message };
        throw err;
      }
    }
    emit("code", { attempt, source: replay ? "replay" : "generated", code });

    // 3. Guard
    const guard = guardGeneratedCode(code);
    emit("guard", { attempt, ok: guard.ok, violations: guard.violations });
    if (!guard.ok) {
      attempts.push({ attempt, stage: "guard", status: "GUARD_REJECTED", message: guard.violations.join(", ") });
      continue;
    }

    // 4. Sandbox
    const run: SandboxRunResult = await runPython({
      entry: "main.py",
      timeoutSeconds: SANDBOX_TIMEOUT_SECONDS,
      files: [
        { path: "recoverly_lib.py", content: lib },
        { path: "data.json", content: dataJson },
        { path: "main.py", content: code },
      ],
    });
    emit("sandbox", {
      attempt,
      status: run.status,
      exitCode: run.exitCode,
      execMs: run.execMs,
      sandboxId: run.sandboxId ? run.sandboxId.slice(0, 8) : null,
      stderrTail: stderrTail(run.stderr),
    });

    if (run.status === "sandbox_error") {
      // Infrastructure problem: the code is not at fault, so no regeneration.
      return { ok: false, code: run.errorCode ?? "SANDBOX_UNAVAILABLE", message: run.error ?? "The sandbox is unavailable." };
    }
    if (run.status === "timeout") {
      attempts.push({ attempt, stage: "sandbox", status: "timeout", message: `Killed after ${SANDBOX_TIMEOUT_SECONDS}s.` });
      continue;
    }
    if (run.status === "nonzero_exit") {
      attempts.push({ attempt, stage: "sandbox", status: `exit_${run.exitCode}`, message: stderrTail(run.stderr) || "Non-zero exit." });
      continue;
    }

    // 5. Validate
    let parsed: unknown;
    try {
      parsed = JSON.parse(run.stdout.trim());
    } catch {
      attempts.push({ attempt, stage: "validate", status: "invalid_json", message: "stdout was not a single JSON document." });
      continue;
    }
    const verdict = validateResult(parsed, plan, dataset.records, dataset.asOf);
    if (!verdict.ok) {
      attempts.push({ attempt, stage: "validate", status: verdict.check, message: verdict.message });
      continue;
    }
    emit("result", { analysisId, result: verdict.result });
    return { ok: true, analysisId, plan, result: verdict.result };
  }

  return failureOutcome(attempts);
}

function failureOutcome(attempts: AttemptSummary[]): PipelineOutcome {
  const last = attempts[attempts.length - 1];
  const details = attempts.map((a) => ({ ...a }));
  if (!last) return { ok: false, code: "GENERATION_FAILED", message: "No script was produced.", details };
  const suffix = attempts.length > 1 ? ` after ${attempts.length} attempts` : "";
  if (last.stage === "validate") {
    return { ok: false, code: "RESULT_INVALID", message: `The sandbox output was rejected${suffix} (${last.status}): ${last.message}`, details };
  }
  if (last.stage === "sandbox" && last.status === "timeout") {
    return { ok: false, code: "SANDBOX_TIMEOUT", message: `The generated script timed out${suffix}.`, details };
  }
  if (last.stage === "sandbox") {
    return { ok: false, code: "SANDBOX_EXEC_FAILED", message: `The generated script failed${suffix}: ${last.message.slice(0, 300)}`, details };
  }
  return { ok: false, code: "GENERATION_FAILED", message: `Code generation failed${suffix} (${last.status}): ${last.message.slice(0, 300)}`, details };
}

