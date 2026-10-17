"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiCallError, postJson } from "@/lib/client/api";
import { errorCopy } from "@/lib/client/copy";
import { formatMoney } from "@/lib/domain/money";
import { TONES, type DraftView, type QueueItem, type Tone } from "@/lib/domain/schemas";
import { Overlay } from "./ui";

interface Approved {
  status: "approved_not_sent" | "sent" | "send_failed";
  auditId: string;
  message: { subject: string; body: string };
}

export function DraftModal({
  item,
  analysisId,
  accessCode,
  onClose,
}: {
  item: QueueItem;
  analysisId: string;
  accessCode: string;
  onClose: () => void;
}) {
  const [tone, setTone] = useState<Tone>("friendly");
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [approved, setApproved] = useState<Approved | null>(null);
  const [approving, setApproving] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(0);

  const generate = useCallback(
    async (nextTone: Tone) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      setApproved(null);
      try {
        const view = await postJson<DraftView>("/api/draft", { analysisId, invoiceId: item.invoice_id, tone: nextTone }, accessCode);
        if (id !== requestId.current) return;
        setDraft(view);
        setBody(view.body);
      } catch (err) {
        if (id !== requestId.current) return;
        setDraft(null);
        setError(err instanceof ApiCallError ? { code: err.code, message: err.message } : { code: "BAD_REQUEST", message: "Could not create the draft." });
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [analysisId, item.invoice_id, accessCode],
  );

  useEffect(() => {
    void generate("friendly");
  }, [generate]);

  const delivery = draft?.delivery.mode === "enabled";
  const allChecksOk = draft?.checks.every((c) => c.ok) ?? false;
  const edited = draft !== null && body.trim() !== draft.body.trim();

  async function approve() {
    if (!draft) return;
    setApproving(true);
    setError(null);
    try {
      const res = await postJson<Approved>(
        `/api/draft/${draft.draftId}/approve`,
        { nonce: draft.approval.nonce, confirm: true, ...(edited ? { editedBody: body } : {}) },
        accessCode,
      );
      setApproved(res);
    } catch (err) {
      setError(err instanceof ApiCallError ? { code: err.code, message: err.message } : { code: "APPROVAL_INVALID", message: "Approval failed." });
    } finally {
      setApproving(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const errCopy = error ? errorCopy(error.code) : null;

  return (
    <Overlay title="Draft message" onClose={onClose} variant="modal" labelledBy="draft-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="draft-title">Draft message</h2>
        <button className="btn" onClick={onClose}>Close</button>
      </div>

      <div className="notice info small">
        <strong>Target:</strong> {item.customer_email_masked} · invoice <span className="mono">{item.invoice_id}</span> · {formatMoney(item.amount_minor, item.currency)}. Drafts are inert until you approve them.
      </div>

      <div className="row">
        <label htmlFor="tone" className="small muted">Tone</label>
        <select id="tone" value={tone} disabled={loading || approving || approved !== null} onChange={(e) => { const t = e.target.value as Tone; setTone(t); void generate(t); }}>
          {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {draft && <span className={`badge ${draft.source === "llm" ? "b-info" : "b-warn"}`}>{draft.source === "llm" ? "Written by the model" : "Template (checked fallback)"}</span>}
      </div>

      {loading && <p className="muted" role="status">Drafting…</p>}

      {error && errCopy && (
        <div className={`notice ${error.code === "DRAFT_NOT_ELIGIBLE" ? "info" : "bad"}`} role="alert">
          <h3>{errCopy.title}</h3>
          <p style={{ margin: "2px 0" }}>{error.message}</p>
          {errCopy.hint && <p className="muted small" style={{ margin: 0 }}>{errCopy.hint}</p>}
        </div>
      )}

      {draft && !approved && (
        <>
          <div className="small muted">Subject</div>
          <div className="message" style={{ padding: "8px 12px" }}>{draft.subject}</div>
          <label htmlFor="body" className="small muted">Message (you can edit; edits are re-checked on approval)</label>
          <textarea id="body" className="message" value={body} onChange={(e) => setBody(e.target.value)} />
          <ul className="checks" aria-label="Content checks">
            {draft.checks.map((c) => <li key={c.name} className={c.ok ? "" : "fail"}>{c.name.replace(/_/g, " ")}{c.ok ? "" : " (failed)"}</li>)}
          </ul>
          <p className="muted small" style={{ margin: 0 }}>Fields used: {draft.fieldsUsed.join(", ")}. The failure code, score and tenure are never used.</p>
          <div className={`notice ${delivery ? "warn" : ""} small`}>{draft.delivery.note}</div>
          <div className="row">
            <button className="btn primary" onClick={approve} disabled={approving || loading || !allChecksOk}>
              {approving ? "Approving…" : delivery ? "Approve draft" : "Approve (will not be sent: delivery is disabled)"}
            </button>
            <button className="btn" onClick={() => copy(`${draft.subject}\n\n${body}`)}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </>
      )}

      {approved && (
        <>
          <div className={`notice ${approved.status === "send_failed" ? "bad" : "ok"}`} role="status">
            <h3>{approved.status === "approved_not_sent" ? "Approved" : approved.status === "sent" ? "Approved and sent" : "Delivery failed"}</h3>
            <p style={{ margin: 0 }}>
              {approved.status === "approved_not_sent" && "Delivery is disabled, so nothing was sent."}
              {approved.status === "sent" && "The message was handed to the delivery adapter."}
              {approved.status === "send_failed" && "The approved draft was preserved so you can retry."}
              {" "}Audit entry <code>{approved.auditId}</code> (no message body is stored).
            </p>
          </div>
          <div className="message"><strong>{approved.message.subject}</strong>{"\n\n"}{approved.message.body}</div>
          <div className="row">
            <button className="btn primary" onClick={() => copy(`${approved.message.subject}\n\n${approved.message.body}`)}>{copied ? "Copied" : "Copy message"}</button>
            <button className="btn" onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Overlay>
  );
}
