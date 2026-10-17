"use client";

import { useEffect, useState } from "react";
import { ApiCallError, getJson } from "@/lib/client/api";
import type { AuditEntry } from "@/lib/domain/schemas";
import { Overlay, formatTime } from "./ui";

export function AuditDrawer({ accessCode, onClose }: { accessCode: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ entries: AuditEntry[] }>("/api/audit", accessCode)
      .then((r) => !cancelled && setEntries(r.entries))
      .catch((e) => !cancelled && setError(e instanceof ApiCallError ? e.message : "Could not load the audit log."));
    return () => {
      cancelled = true;
    };
  }, [accessCode]);

  return (
    <Overlay title="Audit log" onClose={onClose} variant="drawer" labelledBy="audit-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="audit-title">Audit log</h2>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Append-only. Entries hold a message hash and length, never the message body or a raw email.</p>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {!entries && !error && <p className="muted">Loading…</p>}
      {entries && entries.length === 0 && <p className="muted">No drafts or approvals yet.</p>}
      {entries && entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Time</th><th>Action</th><th>Invoice</th><th>Recipient</th><th>Tone</th><th>Delivery</th><th>Hash</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.auditId}>
                  <td>{formatTime(e.ts)}</td>
                  <td>{e.action.replace(/_/g, " ")}</td>
                  <td className="mono">{e.invoiceId}</td>
                  <td>{e.toMasked}</td>
                  <td>{e.tone} / {e.source}</td>
                  <td>{e.deliveryStatus.replace(/_/g, " ")}</td>
                  <td className="mono">{e.messageSha256.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Overlay>
  );
}
