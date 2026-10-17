"use client";

import { useState } from "react";
import { STEPS, type AttemptLog, type RunState, type StepStatus } from "@/lib/client/runState";
import { errorCopy } from "@/lib/client/copy";
import { EXAMPLE_QUESTIONS } from "@/lib/domain/schemas";

const STEP_LABEL: Record<(typeof STEPS)[number], string> = {
  plan: "Plan",
  code: "Code",
  guard: "Guard",
  sandbox: "Sandbox",
  validate: "Validate",
};

const STATUS_TEXT: Record<StepStatus, string> = { pending: "pending", running: "running", ok: "ok", failed: "failed" };

function fmtMs(ms: number | null): string {
  if (ms === null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function Stepper({ run }: { run: RunState }) {
  return (
    <ol className="stepper" aria-label="Pipeline steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {STEPS.map((step) => {
        const s = run.steps[step];
        return (
          <li key={step} className={`step ${s.status}`}>
            <div className="name">{STEP_LABEL[step]}</div>
            <div className="st">
              {STATUS_TEXT[s.status]}
              {s.ms !== null ? ` · ${fmtMs(s.ms)}` : ""}
              {run.attempt > 1 && step !== "plan" ? " · attempt 2" : ""}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PlanCard({ run, onPick }: { run: RunState; onPick: (q: string) => void }) {
  const plan = run.plan;
  if (!plan) return null;
  if (plan.intent === "unsupported") {
    return (
      <div className="notice info" role="status">
        <h3>That request is not supported</h3>
        <p style={{ margin: "4px 0 8px" }}>{plan.unsupported_reason}</p>
        <div className="row">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button key={q} className="example" onClick={() => onPick(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const f = plan.filters;
  const chips: string[] = [];
  if (f.failed_within_days !== undefined) chips.push(`failed within ${f.failed_within_days} days`);
  if (f.min_amount_minor !== undefined) chips.push(`amount ≥ ${(f.min_amount_minor / 100).toFixed(2)}`);
  if (f.currency) chips.push(`currency ${f.currency.toUpperCase()}`);
  if (f.states?.length) chips.push(`states: ${f.states.join(", ")}`);
  if (f.failure_codes?.length) chips.push(`codes: ${f.failure_codes.join(", ")}`);
  if (f.priority_at_least) chips.push(`priority ≥ ${f.priority_at_least}`);
  if (!chips.length) chips.push("no filters");
  return (
    <section className="card" aria-label="Plan">
      <header>
        <h2>Plan</h2>
        <span className="muted small">Shown before any code runs · {run.planSource === "replay" ? "saved plan (replay)" : "written by the planner"}</span>
      </header>
      <p style={{ margin: 0 }}>{plan.explanation}</p>
      <div className="plan-chips">
        {chips.map((c) => (
          <span key={c} className="tag">{c}</span>
        ))}
        <span className="tag">top {plan.top_n}</span>
        <span className="tag">intent: {plan.intent.replace("_", " ")}</span>
      </div>
      {plan.fields_used.length > 0 && (
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Fields used: {plan.fields_used.map((x) => (
            <span key={x}>
              <code>{x}</code>{" "}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function AttemptView({ log }: { log: AttemptLog }) {
  const sb = log.sandbox;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="row">
        <span className={`badge ${log.source === "replay" ? "b-warn" : "b-info"}`}>
          {log.source === "replay" ? "Replay (saved script)" : "Generated"}
        </span>
        <span className="muted small">
          {log.source === "replay" ? "Saved script, not freshly generated." : "Written by the model for this question."}
        </span>
      </div>
      {log.code ? <pre className="code mono" tabIndex={0}>{log.code}</pre> : <p className="muted">No code was produced for this attempt.</p>}
      <div className="kv" style={{ gridTemplateColumns: "130px 1fr" }}>
        <span className="k">Guard</span>
        <span>
          {log.guard ? (
            log.guard.ok ? (
              <span className="badge b-ok">passed</span>
            ) : (
              <span>
                <span className="badge b-bad">rejected</span> {log.guard.violations.map((v) => <code key={v} style={{ marginLeft: 6 }}>{v}</code>)}
              </span>
            )
          ) : (
            <span className="muted">not run</span>
          )}
        </span>
        <span className="k">Sandbox</span>
        <span>
          {sb ? (
            <>
              <span className={`badge ${sb.status === "ok" ? "b-ok" : "b-bad"}`}>{sb.status}</span>{" "}
              <span className="muted small">
                exit {sb.exitCode ?? "—"} · {sb.execMs !== null ? `${Math.round(sb.execMs)} ms` : "—"} · sandbox {sb.sandboxId ?? "—"}
              </span>
            </>
          ) : (
            <span className="muted">not run</span>
          )}
        </span>
      </div>
      {sb?.stderrTail ? <pre className="code mono" aria-label="stderr tail">{sb.stderrTail}</pre> : null}
    </div>
  );
}

export function CodeAndLog({ run }: { run: RunState }) {
  const [tab, setTab] = useState<number | null>(null);
  if (!run.attempts.length) return null;
  const selected = run.attempts.find((a) => a.attempt === (tab ?? run.attempts[run.attempts.length - 1]!.attempt)) ?? run.attempts[0]!;
  return (
    <details className="panel" open={run.attempts.some((a) => a.guard && !a.guard.ok) || Boolean(run.error)}>
      <summary>
        Generated code and run log
        <span className="muted small">
          {run.attempts.length > 1 ? `${run.attempts.length} attempts` : "1 attempt"} · executed in an isolated CreateOS Sandbox (network blocked)
        </span>
      </summary>
      <div className="body">
        {run.attempts.length > 1 && (
          <div className="tabs" role="tablist">
            {run.attempts.map((a) => (
              <button key={a.attempt} role="tab" className="tab" aria-selected={a.attempt === selected.attempt} onClick={() => setTab(a.attempt)}>
                Attempt {a.attempt}
              </button>
            ))}
          </div>
        )}
        <AttemptView log={selected} />
      </div>
    </details>
  );
}

export function ErrorPanel({ run }: { run: RunState }) {
  const err = run.error;
  if (!err) return null;
  // The plan card already explains an unsupported request; do not repeat it.
  if (err.code === "UNSUPPORTED_REQUEST" && run.plan?.intent === "unsupported") return null;
  const copy = errorCopy(err.code);
  const details = (err.details ?? []) as Array<Record<string, unknown>>;
  return (
    <div className="notice bad" role="alert">
      <h3>{copy.title}</h3>
      <p style={{ margin: "2px 0" }}>{err.message}</p>
      {copy.hint && <p className="muted small" style={{ margin: "2px 0" }}>{copy.hint}</p>}
      {details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={i}>
              {"attempt" in d ? `Attempt ${String(d.attempt)}: ` : ""}
              <code>{String(d.stage ?? "")} {String(d.status ?? "")}</code> {String(d.message ?? "")}
            </li>
          ))}
        </ul>
      )}
      <p className="small muted" style={{ margin: "6px 0 0" }}>Error code: <code>{err.code}</code> · no result is shown for a failed run.</p>
    </div>
  );
}
