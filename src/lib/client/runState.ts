/** Pure reducer that turns SSE events into the stepper / log state the dashboard renders. */
import type { AnalysisPlan, AnalysisResult } from "../domain/schemas";

export const STEPS = ["plan", "code", "guard", "sandbox", "validate"] as const;
export type Step = (typeof STEPS)[number];
export type StepStatus = "pending" | "running" | "ok" | "failed";

export interface AttemptLog {
  attempt: number;
  source: "generated" | "replay";
  code: string;
  guard?: { ok: boolean; violations: string[] };
  sandbox?: { status: string; exitCode: number | null; execMs: number | null; sandboxId: string | null; stderrTail: string };
}

export interface RunError {
  code: string;
  message: string;
  details?: unknown[];
}

export interface RunState {
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  steps: Record<Step, { status: StepStatus; ms: number | null }>;
  stepStartedAt: number;
  attempt: number;
  analysisId: string | null;
  plan: AnalysisPlan | null;
  planSource: "generated" | "replay" | null;
  attempts: AttemptLog[];
  result: AnalysisResult | null;
  error: RunError | null;
}

const freshSteps = (): RunState["steps"] => ({
  plan: { status: "pending", ms: null },
  code: { status: "pending", ms: null },
  guard: { status: "pending", ms: null },
  sandbox: { status: "pending", ms: null },
  validate: { status: "pending", ms: null },
});

export function initialRun(now: number): RunState {
  const steps = freshSteps();
  steps.plan.status = "running";
  return {
    running: true,
    startedAt: now,
    finishedAt: null,
    steps,
    stepStartedAt: now,
    attempt: 1,
    analysisId: null,
    plan: null,
    planSource: null,
    attempts: [],
    result: null,
    error: null,
  };
}

function finishStep(s: RunState, step: Step, status: StepStatus, now: number, ms?: number | null): RunState["steps"] {
  return { ...s.steps, [step]: { status, ms: ms ?? now - s.stepStartedAt } };
}

function startStep(steps: RunState["steps"], step: Step): RunState["steps"] {
  return { ...steps, [step]: { status: "running", ms: null } };
}

function upsertAttempt(attempts: AttemptLog[], attempt: number, patch: Partial<AttemptLog>): AttemptLog[] {
  const existing = attempts.find((a) => a.attempt === attempt);
  if (existing) return attempts.map((a) => (a.attempt === attempt ? { ...a, ...patch } : a));
  return [...attempts, { attempt, source: "generated", code: "", ...patch }];
}

export function reduceEvent(s: RunState, event: string, data: unknown, now: number): RunState {
  const d = data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (event) {
    case "plan": {
      const unsupported = (d.plan as AnalysisPlan).intent === "unsupported";
      let steps = finishStep(s, "plan", "ok", now);
      if (!unsupported) steps = startStep(steps, "code");
      return { ...s, steps, stepStartedAt: now, analysisId: d.analysisId, plan: d.plan, planSource: d.source };
    }
    case "code": {
      const attempt = d.attempt as number;
      let steps = s.steps;
      if (attempt > 1 && s.attempt !== attempt) {
        // A retry: keep the earlier attempt's log, reset the downstream steps.
        steps = { ...steps, code: { status: "pending", ms: null }, guard: { status: "pending", ms: null }, sandbox: { status: "pending", ms: null }, validate: { status: "pending", ms: null } };
      }
      steps = { ...steps, code: { status: "ok", ms: now - s.stepStartedAt } };
      steps = startStep(steps, "guard");
      return { ...s, steps, attempt, stepStartedAt: now, attempts: upsertAttempt(s.attempts, attempt, { source: d.source, code: d.code }) };
    }
    case "guard": {
      const ok = d.ok as boolean;
      let steps = finishStep(s, "guard", ok ? "ok" : "failed", now);
      if (ok) steps = startStep(steps, "sandbox");
      return { ...s, steps, stepStartedAt: now, attempts: upsertAttempt(s.attempts, d.attempt, { guard: { ok, violations: d.violations } }) };
    }
    case "sandbox": {
      const ok = d.status === "ok";
      let steps = finishStep(s, "sandbox", ok ? "ok" : "failed", now, d.execMs ?? null);
      if (ok) steps = startStep(steps, "validate");
      return {
        ...s,
        steps,
        stepStartedAt: now,
        attempts: upsertAttempt(s.attempts, d.attempt, {
          sandbox: { status: d.status, exitCode: d.exitCode, execMs: d.execMs, sandboxId: d.sandboxId, stderrTail: d.stderrTail ?? "" },
        }),
      };
    }
    case "result":
      return { ...s, steps: finishStep(s, "validate", "ok", now), analysisId: d.analysisId, result: d.result, stepStartedAt: now };
    case "error": {
      // Mark whichever step was in flight as failed so a failure never looks like success.
      const running = STEPS.find((k) => s.steps[k].status === "running");
      const steps = running ? finishStep(s, running, "failed", now) : s.steps;
      return { ...s, steps, error: { code: d.code, message: d.message, details: d.details } };
    }
    case "done":
      return { ...s, running: false, finishedAt: now };
    default:
      return s;
  }
}

export function failRun(s: RunState, error: RunError, now: number): RunState {
  const running = STEPS.find((k) => s.steps[k].status === "running");
  const steps = running ? finishStep(s, running, "failed", now) : s.steps;
  return { ...s, steps, running: false, finishedAt: now, error };
}
