/**
 * Smoke test against a running instance (local `npm run dev` / `npm start`, or the deployed URL):
 * health -> load fixture -> run the demo question -> check Golden B headline values -> draft -> approve -> audit.
 *
 *   npm run smoke -- http://localhost:3000            # real LLM + real sandbox
 *   npm run smoke -- https://your-app --replay        # skip the LLM (saved script)
 *   RECOVERLY_ACCESS_CODE=... npm run smoke -- <url>  # when the demo is locked
 */
import { DEMO_QUESTION, type AnalysisResult, type DraftView } from "../src/lib/domain/schemas";

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const replay = args.includes("--replay");
const headers: Record<string, string> = { "content-type": "application/json" };
if (process.env.RECOVERLY_ACCESS_CODE) headers["x-access-code"] = process.env.RECOVERLY_ACCESS_CODE;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  check("health", health.ok === true && health.app === "recoverly", JSON.stringify(health.config));

  const load = await fetch(`${base}/api/data/load`, { method: "POST", headers, body: JSON.stringify({ source: "fixture" }) });
  const dataset = await load.json();
  check("load fixture", load.ok && dataset.rows === 13 && dataset.synthetic === true, `${dataset.rows} rows, ${dataset.currencies?.join("+")}`);

  const started = Date.now();
  const res = await fetch(`${base}/api/analyze`, { method: "POST", headers, body: JSON.stringify({ datasetId: dataset.datasetId, question: DEMO_QUESTION, replay }) });
  check("analyze stream opens", res.ok && (res.headers.get("content-type") ?? "").includes("text/event-stream"), `HTTP ${res.status}`);
  const events: Array<{ event: string; data: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const block of (await res.text()).split("\n\n").filter(Boolean)) {
    const event = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  const names = events.map((e) => e.event);
  check("event order", names.join(",") === "plan,code,guard,sandbox,result,done", names.join(","));
  const error = events.find((e) => e.event === "error");
  if (error) console.error(`      error: ${error.data.code}: ${error.data.message}`);
  const done = events.find((e) => e.event === "result");
  if (!done) throw new Error("no result event");
  const result = done.data.result as AnalysisResult;
  check("time to queue", true, `${((Date.now() - started) / 1000).toFixed(1)} s${replay ? " (replay)" : ""}`);

  const usd = result.queues.find((q) => q.currency === "usd")?.items ?? [];
  check("golden B: usd top 3", usd.slice(0, 3).map((i) => i.invoice_id).join() === "in_synth_001,in_synth_009,in_synth_007", usd.slice(0, 3).map((i) => `${i.invoice_id}=${i.score}`).join(" "));
  check("golden B: usd count and scores", usd.length === 9 && usd[0]?.score === 85 && usd[1]?.score === 55.5);
  check("golden B: eur separate", result.queues.find((q) => q.currency === "eur")?.items[0]?.invoice_id === "in_synth_012");
  const usdMetrics = result.metrics.by_currency.find((m) => m.currency === "usd");
  check("golden B: usd at risk", usdMetrics?.amount_at_risk_minor === 136200, String(usdMetrics?.amount_at_risk_minor));
  check("golden B: scope and resolved", result.metrics.records_in_scope === 11 && result.resolved.map((r) => r.invoice_id).join() === "in_synth_004");
  check("single_item_currency warning", result.warnings.includes("single_item_currency:eur"));
  check("no raw emails in the result", !JSON.stringify(result).includes("@example.test") || /\*\*\*@example\.test/.test(JSON.stringify(result)) && !/[a-z]{2,}\.[a-z]+@example\.test/.test(JSON.stringify(result)));

  const draftRes = await fetch(`${base}/api/draft`, { method: "POST", headers, body: JSON.stringify({ analysisId: done.data.analysisId, invoiceId: "in_synth_001", tone: "concise" }) });
  const draft = (await draftRes.json()) as DraftView;
  check("draft", draftRes.ok && draft.checks.every((c) => c.ok) && draft.body.includes("$499.00"), `${draft.source}, ${draft.checks.length} checks`);
  check("draft recipient masked", draft.toMasked === "a***@example.test");

  const bad = await fetch(`${base}/api/draft/${draft.draftId}/approve`, { method: "POST", headers, body: JSON.stringify({ nonce: "wrong", confirm: true }) });
  check("bad nonce refused", bad.status === 403);
  const approve = await fetch(`${base}/api/draft/${draft.draftId}/approve`, { method: "POST", headers, body: JSON.stringify({ nonce: draft.approval.nonce, confirm: true }) });
  const approved = await approve.json();
  check("approve", approve.ok && ["approved_not_sent", "sent"].includes(approved.status), approved.status);

  const audit = await fetch(`${base}/api/audit`, { headers }).then((r) => r.json());
  const actions: string[] = audit.entries.map((e: { action: string }) => e.action);
  check("audit has the trail and no body", actions.includes("draft_approved") && actions.includes("draft_generated") && !JSON.stringify(audit).includes(draft.body.slice(0, 25)));

  console.log(failures ? `\n${failures} check(s) failed` : "\nsmoke OK");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
