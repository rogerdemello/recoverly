"use client";

import { formatMoney } from "@/lib/domain/money";
import { DRAFT_ELIGIBLE_ACTIONS, type QueueItem } from "@/lib/domain/schemas";
import { ACTION_LABEL, ACTION_WHY, MISSING_COPY, STATE_LABEL } from "@/lib/client/copy";
import { ConfidenceBadge, Overlay, PriorityBadge, formatTime } from "./ui";

const BARS: Array<{ key: keyof QueueItem["components"]; label: string; max: number }> = [
  { key: "amount_norm", label: "Amount at risk", max: 45 },
  { key: "recovery", label: "Recovery signal", max: 25 },
  { key: "urgency", label: "Urgency", max: 20 },
  { key: "value", label: "Customer tenure", max: 10 },
];

function evidenceValue(v: string | number | null): string {
  return v === null || v === "" ? "—" : String(v);
}

export function DetailDrawer({
  item,
  onClose,
  onDraft,
}: {
  item: QueueItem;
  onClose: () => void;
  onDraft: (item: QueueItem) => void;
}) {
  const eligible = DRAFT_ELIGIBLE_ACTIONS.includes(item.recommended_action);
  const retry = item.retry;
  return (
    <Overlay title={`Details for ${item.invoice_id}`} onClose={onClose} variant="drawer" labelledBy="detail-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 id="detail-title" className="mono">{item.invoice_id}</h2>
          <div className="muted">{item.customer_email_masked || item.customer_id} · {formatMoney(item.amount_minor, item.currency)}</div>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close details">Close</button>
      </div>

      <div className="row">
        <PriorityBadge priority={item.priority} />
        <ConfidenceBadge confidence={item.confidence} />
        <span className="badge b-info">{STATE_LABEL[item.state]}</span>
        <span className="muted small">Rank {item.rank} · score {item.score.toFixed(1)} / 100 (heuristic, not a prediction)</span>
      </div>

      <section aria-label="Why this rank" style={{ display: "grid", gap: 8 }}>
        <h3>Why this rank</h3>
        <div className="bars">
          {BARS.map((b) => {
            const points = b.max * item.components[b.key];
            return (
              <div key={b.key} className="bar-row">
                <span>{b.label}</span>
                <div className="bar-track" role="img" aria-label={`${b.label}: ${points.toFixed(1)} of ${b.max} points`}>
                  <div className="bar-fill" style={{ width: `${Math.min(100, (points / b.max) * 100)}%` }} />
                </div>
                <span className="mono">{points.toFixed(1)} / {b.max}</span>
              </div>
            );
          })}
        </div>
        <p style={{ margin: 0 }}>{item.reason}</p>
      </section>

      <section aria-label="What we know versus infer" style={{ display: "grid", gap: 6 }}>
        <h3>What we know vs. infer</h3>
        <div className="kv">
          {item.evidence.map((e) => (
            <div key={e.field} style={{ display: "contents" }}>
              <span className="k mono">{e.field}</span>
              <span className="mono" style={{ overflowWrap: "anywhere" }}>{evidenceValue(e.value)}</span>
              <span className={`badge ${e.source === "stripe_fact" ? "b-fact" : "b-inference"}`}>
                {e.source === "stripe_fact" ? "Stripe fact" : "Agent inference"}
              </span>
            </div>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Demo values follow the Stripe object model; synthetic data is labelled as such in the header.</p>
      </section>

      <section aria-label="What is uncertain" style={{ display: "grid", gap: 6 }}>
        <h3>What is uncertain</h3>
        <div><ConfidenceBadge confidence={item.confidence} /></div>
        {item.missing_inputs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No missing inputs.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {item.missing_inputs.map((m) => (
              <li key={m}><code>{m}</code>: {MISSING_COPY[m] ?? "This input is missing."}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Retry status" style={{ display: "grid", gap: 4 }}>
        <h3>Retry status</h3>
        <p style={{ margin: 0 }}>
          {retry.status === "scheduled" && `A retry is scheduled for ${retry.next_attempt_at ? formatTime(retry.next_attempt_at) : "a future time"}.`}
          {retry.status === "none_scheduled" && "No retry is scheduled."}
          {retry.status === "unknown" && "Retry information is unavailable, so we cannot say whether a retry is scheduled."}
        </p>
        <p className="muted small" style={{ margin: 0 }}>{item.attempt_count} attempt(s) so far · failed {item.days_since_failure.toFixed(1)} days before the snapshot.</p>
      </section>

      <section aria-label="Recommended next step" style={{ display: "grid", gap: 8 }}>
        <h3>Recommended next step</h3>
        <div><strong>{ACTION_LABEL[item.recommended_action]}</strong></div>
        <p style={{ margin: 0 }}>{ACTION_WHY[item.recommended_action]}</p>
        {eligible ? (
          <div><button className="btn primary" onClick={() => onDraft(item)}>Draft message</button></div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No message needed: {ACTION_WHY[item.recommended_action].toLowerCase()}</p>
        )}
      </section>
    </Overlay>
  );
}
