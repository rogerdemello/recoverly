"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiCallError, getJson, postJson, streamSse, uploadCsv } from "@/lib/client/api";
import { errorCopy } from "@/lib/client/copy";
import { failRun, initialRun, reduceEvent, type RunState } from "@/lib/client/runState";
import {
  DRAFT_ELIGIBLE_ACTIONS,
  EXAMPLE_QUESTIONS,
  type DatasetSummary,
  type QueueItem,
} from "@/lib/domain/schemas";
import { AuditDrawer } from "./AuditDrawer";
import { DetailDrawer } from "./DetailDrawer";
import { DraftModal } from "./DraftModal";
import { CodeAndLog, ErrorPanel, PlanCard, Stepper } from "./Pipeline";
import { Breakdowns, Queues, Resolved, Tiles, Warnings } from "./Results";
import { formatTime } from "./ui";

interface Health {
  ok: boolean;
  config: { sandbox: boolean; llm: boolean; sendEnabled: boolean };
}

interface CsvProblem {
  row: number;
  column: string;
  problem: string;
}

const MAX_QUESTION = 500;

export function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<{ code: string; message: string; problems?: CsvProblem[] } | null>(null);
  const [question, setQuestion] = useState(EXAMPLE_QUESTIONS[0]!);
  const [replay, setReplay] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [drafting, setDrafting] = useState<QueueItem | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getJson<Health>("/api/health", "")
      .then(setHealth)
      .catch(() => setHealthError(true));
    return () => abortRef.current?.abort();
  }, []);

  const handleAuth = useCallback((err: unknown) => {
    if (err instanceof ApiCallError && err.code === "UNAUTHORIZED") setNeedsCode(true);
  }, []);

  async function loadDemo() {
    setLoadingData(true);
    setDataError(null);
    try {
      setDataset(await postJson<DatasetSummary>("/api/data/load", { source: "fixture" }, accessCode));
      setRun(null);
    } catch (err) {
      handleAuth(err);
      setDataError({ code: err instanceof ApiCallError ? err.code : "BAD_REQUEST", message: err instanceof ApiCallError ? err.message : "Could not load the demo data." });
    } finally {
      setLoadingData(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setLoadingData(true);
    setDataError(null);
    try {
      setDataset(await uploadCsv<DatasetSummary>(file, accessCode));
      setRun(null);
    } catch (err) {
      handleAuth(err);
      if (err instanceof ApiCallError) {
        setDataError({ code: err.code, message: err.message, problems: err.code === "CSV_INVALID" ? (err.details as CsvProblem[]) : undefined });
      } else {
        setDataError({ code: "BAD_REQUEST", message: "Could not upload the file." });
      }
      setDataset(null);
    } finally {
      setLoadingData(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function analyze() {
    if (!dataset || run?.running) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSelected(null);
    setRun(initialRun(Date.now()));
    try {
      await streamSse(
        "/api/analyze",
        { datasetId: dataset.datasetId, question, replay },
        accessCode,
        (event, data) => setRun((prev) => (prev ? reduceEvent(prev, event, data, Date.now()) : prev)),
        controller.signal,
      );
      setRun((prev) => (prev && prev.running ? { ...prev, running: false, finishedAt: Date.now() } : prev));
    } catch (err) {
      if (controller.signal.aborted) return;
      handleAuth(err);
      const error = err instanceof ApiCallError ? { code: err.code, message: err.message } : { code: "GENERATION_FAILED", message: "The connection to the server was interrupted." };
      setRun((prev) => (prev ? failRun(prev, error, Date.now()) : prev));
    }
  }

  const result = run?.result ?? null;
  const elapsed = run?.finishedAt && run.result ? ((run.finishedAt - run.startedAt) / 1000).toFixed(1) : null;
  const overLimit = question.length > MAX_QUESTION;
  const draftTargets = result && run?.plan?.then_draft
    ? result.queues.flatMap((q) => q.items).filter((i) => DRAFT_ELIGIBLE_ACTIONS.includes(i.recommended_action)).slice(0, run.plan.top_n)
    : [];

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <h1>Recoverly</h1>
          <p className="tagline">Explainable failed-payment recovery. Analysis code is written by an agent and run in an isolated sandbox.</p>
        </div>
        <div className="chips" aria-label="Integrations">
          {healthError ? (
            <span className="chip off"><span className="dot" />Server unreachable</span>
          ) : (
            <>
              <span className={`chip ${health ? (health.config.sandbox ? "on" : "off") : ""}`}><span className="dot" />Sandbox: {health ? (health.config.sandbox ? "configured" : "not configured") : "…"}</span>
              <span className={`chip ${health ? (health.config.llm ? "on" : "off") : ""}`}><span className="dot" />LLM: {health ? (health.config.llm ? "configured" : "not configured") : "…"}</span>
              <span className="chip neutral"><span className="dot" />Message delivery: {health?.config.sendEnabled ? "enabled" : "draft-only"}</span>
            </>
          )}
          <button className="btn" onClick={() => setAuditOpen(true)}>Audit log</button>
        </div>
      </header>

      {needsCode && (
        <div className="notice warn" role="alert">
          <h3>{errorCopy("UNAUTHORIZED").title}</h3>
          <div className="row" style={{ marginTop: 6 }}>
            <label htmlFor="code" className="small">Access code</label>
            <input id="code" type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} autoComplete="off" />
            <span className="muted small">Then repeat your last action.</span>
          </div>
        </div>
      )}

      <section className="card" aria-label="Data source">
        <header>
          <h2>Data</h2>
          <div className="row">
            <button className="btn primary" onClick={loadDemo} disabled={loadingData}>Load demo data</button>
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={loadingData}>Upload CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Upload CSV file" />
          </div>
        </header>
        {!dataset && !dataError && (
          <p className="muted" style={{ margin: 0 }}>
            Load the synthetic demo dataset (13 failed invoices, USD and EUR) or upload a CSV with the documented columns. Customer emails are masked before anything reaches the sandbox.
          </p>
        )}
        {dataset && (
          <div className="chips" aria-label="Dataset">
            <span className="chip">{dataset.rows} rows</span>
            <span className="chip">{dataset.currencies.map((c) => c.toUpperCase()).join(" + ")}</span>
            <span className="chip">as of {formatTime(dataset.asOf)}</span>
            {dataset.synthetic ? <span className="badge b-warn">Synthetic demo data</span> : <span className="badge b-info">Uploaded CSV</span>}
          </div>
        )}
        {dataError && (
          <div className="notice bad" role="alert">
            <h3>{errorCopy(dataError.code).title}</h3>
            {errorCopy(dataError.code).hint && dataError.problems && <p className="muted small" style={{ margin: "2px 0" }}>{errorCopy(dataError.code).hint}</p>}
            {!dataError.problems && <p style={{ margin: "2px 0" }}>{dataError.message}</p>}
            {dataError.problems && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
                  <tbody>
                    {dataError.problems.slice(0, 20).map((p, i) => (
                      <tr key={i}><td>{p.row === 0 ? "header" : p.row}</td><td><code>{p.column}</code></td><td><code>{p.problem}</code></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card" aria-label="Ask">
        <header>
          <h2>Ask</h2>
          <span className={`counter ${overLimit ? "over" : ""}`}>{question.length} / {MAX_QUESTION}</span>
        </header>
        <label htmlFor="question" className="sr-only">Question</label>
        <textarea id="question" className="ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a plain-English question about the failed payments…" />
        <div className="row" style={{ margin: "10px 0" }} aria-label="Example questions">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button key={q} className="example" onClick={() => setQuestion(q)}>{q.length > 70 ? `${q.slice(0, 68)}…` : q}</button>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={analyze} disabled={!dataset || overLimit || !question.trim() || Boolean(run?.running)}>
            {run?.running ? "Running…" : "Run analysis"}
          </button>
          <label className="row small" title="Skips code generation; runs a previously saved script in the sandbox">
            <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} />
            Replay saved script
          </label>
          {!dataset && <span className="muted small">Load data first.</span>}
          <span className="muted small grow" style={{ textAlign: "right" }}>
            Recoverly does not replace Stripe Smart Retries or Stripe&apos;s customer emails. It helps decide what to do next.
          </span>
        </div>
        {replay && <p className="muted small" style={{ margin: "8px 0 0" }}>Replay runs the saved ranking script for the demo question; your question text is not used.</p>}
      </section>

      {run && (
        <section aria-label="Pipeline" style={{ display: "grid", gap: 12 }}>
          <Stepper run={run} />
          {elapsed && <div className="notice ok" role="status">Recovery queue ready in {elapsed} s{run.planSource === "replay" ? " (replayed saved script, not freshly generated)" : ""}.</div>}
          <PlanCard run={run} onPick={(q) => setQuestion(q)} />
          <ErrorPanel run={run} />
          <CodeAndLog run={run} />
        </section>
      )}

      {result && (
        <>
          <section className="card" aria-label="Summary">
            <header><h2>Result</h2><span className="muted small">All figures come from validated sandbox output, not from the model.</span></header>
            <p style={{ margin: 0 }}>{result.summary}</p>
          </section>
          <Warnings warnings={result.warnings} />
          {draftTargets.length > 0 && (
            <div className="notice info" role="status">
              <h3>You asked for drafts</h3>
              <div className="row" style={{ marginTop: 6 }}>
                {draftTargets.map((i) => (
                  <button key={i.invoice_id} className="btn" onClick={() => setDrafting(i)}>Draft for {i.invoice_id}</button>
                ))}
              </div>
              <p className="muted small" style={{ margin: "6px 0 0" }}>Drafting never sends anything; each draft needs your explicit approval.</p>
            </div>
          )}
          <Tiles result={result} />
          <Breakdowns result={result} />
          <Queues result={result} onOpen={setSelected} />
          <Resolved result={result} />
        </>
      )}

      {selected && (
        <DetailDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onDraft={(item) => {
            setSelected(null);
            setDrafting(item);
          }}
        />
      )}
      {drafting && run?.analysisId && (
        <DraftModal item={drafting} analysisId={run.analysisId} accessCode={accessCode} onClose={() => setDrafting(null)} />
      )}
      {auditOpen && <AuditDrawer accessCode={accessCode} onClose={() => setAuditOpen(false)} />}

      <footer className="muted small">
        Scores are a heuristic for triage, not a prediction of recovery. Recoverly never charges, retries, cancels or sends anything on its own.
      </footer>
    </div>
  );
}
