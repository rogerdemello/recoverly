"use client";

import { formatMoney } from "@/lib/domain/money";
import type { AnalysisResult, QueueItem } from "@/lib/domain/schemas";
import { ACTION_LABEL, STATE_LABEL, warningCopy } from "@/lib/client/copy";
import { ConfidenceBadge, PriorityBadge } from "./ui";

export function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="notice warn" role="status">
      <h3>Read before acting</h3>
      <ul>
        {warnings.map((w) => (
          <li key={w}>{warningCopy(w)}</li>
        ))}
      </ul>
    </div>
  );
}

export function Tiles({ result }: { result: AnalysisResult }) {
  const rows = result.metrics.by_currency;
  if (!rows.length) return null;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {rows.map((m) => (
        <div key={m.currency} className="tiles-group" role="group" aria-label={`${m.currency.toUpperCase()} metrics`}>
          <h3>
            {m.currency.toUpperCase()} <span className="muted small">· never added to other currencies</span>
          </h3>
          <div className="tiles">
            <div className="tile">
              <div className="label">Amount at risk</div>
              <div className="value">{formatMoney(m.amount_at_risk_minor, m.currency)}</div>
            </div>
            <div className="tile">
              <div className="label">Affected customers</div>
              <div className="value">{m.affected_customers}</div>
            </div>
            <div className="tile">
              <div className="label">In recovery (retry scheduled)</div>
              <div className="value">{formatMoney(m.in_recovery_minor, m.currency)}</div>
            </div>
            <div className="tile">
              <div className="label">Queued invoices</div>
              <div className="value">{m.failed_count}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Breakdowns({ result }: { result: AnalysisResult }) {
  const { by_failure_code, by_state } = result.metrics;
  if (!by_failure_code.length && !by_state.length) return null;
  return (
    <div className="two">
      <section className="card" aria-label="Failure reasons">
        <header>
          <h2>Failure reasons</h2>
          <span className="muted small">unresolved invoices</span>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Currency</th>
                <th>Failure code</th>
                <th className="num">Invoices</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {by_failure_code.map((r) => (
                <tr key={`${r.currency}-${r.failure_code}`}>
                  <td>{r.currency.toUpperCase()}</td>
                  <td><code>{r.failure_code}</code></td>
                  <td className="num">{r.count}</td>
                  <td className="num">{formatMoney(r.amount_minor, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-label="Recovery status">
        <header>
          <h2>Recovery status</h2>
          <span className="muted small">all invoices in scope</span>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Currency</th>
                <th>State</th>
                <th className="num">Invoices</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {by_state.map((r) => (
                <tr key={`${r.currency}-${r.state}`}>
                  <td>{r.currency.toUpperCase()}</td>
                  <td>{STATE_LABEL[r.state] ?? r.state}</td>
                  <td className="num">{r.count}</td>
                  <td className="num">{formatMoney(r.amount_minor, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function Queues({ result, onOpen }: { result: AnalysisResult; onOpen: (item: QueueItem) => void }) {
  if (!result.queues.length) {
    return (
      <section className="card">
        <h2>Recovery queue</h2>
        <p className="muted">Nothing to act on in this scope.</p>
      </section>
    );
  }
  return (
    <>
      {result.queues.map((q) => (
        <section key={q.currency} className="card" aria-label={`${q.currency.toUpperCase()} recovery queue`}>
          <header>
            <h2>{q.currency.toUpperCase()} recovery queue</h2>
            <span className="muted small">Click a row for the evidence · scores are only comparable within this currency</span>
          </header>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Customer</th>
                  <th className="num">Amount</th>
                  <th>Priority</th>
                  <th>State</th>
                  <th>Recommended action</th>
                  <th>Confidence</th>
                  <th className="num" title="Heuristic triage score from 0 to 100. Not a prediction of recovery.">
                    Score <span aria-hidden="true">ⓘ</span>
                    <span className="sr-only">Heuristic triage score from 0 to 100. Not a prediction of recovery.</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.items.map((item) => (
                  <tr
                    key={item.invoice_id}
                    className="click"
                    tabIndex={0}
                    aria-label={`Open details for ${item.invoice_id}`}
                    onClick={() => onOpen(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(item);
                      }
                    }}
                  >
                    <td>{item.rank}</td>
                    <td>
                      <div>{item.customer_email_masked || item.customer_id}</div>
                      <div className="muted small mono">{item.invoice_id}</div>
                    </td>
                    <td className="num">{formatMoney(item.amount_minor, item.currency)}</td>
                    <td><PriorityBadge priority={item.priority} /></td>
                    <td>{STATE_LABEL[item.state] ?? item.state}</td>
                    <td>{ACTION_LABEL[item.recommended_action]}</td>
                    <td><ConfidenceBadge confidence={item.confidence} /></td>
                    <td className="num"><strong>{item.score.toFixed(1)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

export function Resolved({ result }: { result: AnalysisResult }) {
  if (!result.resolved.length) return null;
  return (
    <details className="panel">
      <summary>
        Resolved ({result.resolved.length})
        <span className="muted small">paid, void or uncollectible: removed from the action queue</span>
      </summary>
      <div className="body table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Customer</th>
              <th className="num">Amount</th>
              <th>State</th>
              <th>Action</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {result.resolved.map((r) => (
              <tr key={r.invoice_id}>
                <td className="mono">{r.invoice_id}</td>
                <td className="mono">{r.customer_id}</td>
                <td className="num">{formatMoney(r.amount_minor, r.currency)}</td>
                <td>{STATE_LABEL[r.state]}</td>
                <td>{ACTION_LABEL[r.recommended_action]}</td>
                <td>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
