/**
 * Server-side validation of sandbox output (technical-spec 4.1). Everything here is verified against the
 * RAW dataset, never against the script's own claims, so a script that silently drops, adds or alters
 * records is rejected as RESULT_INVALID.
 */
import { analysisResultSchema, PRIORITIES, type AnalysisPlan, type AnalysisResult } from "../domain/schemas";
import { maskEmail, type DatasetRecord } from "../domain/csv";

export type ValidationOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; check: string; message: string };

const fail = (check: string, message: string): ValidationOutcome => ({ ok: false, check, message });

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function daysSince(asOfMs: number, iso: string): number {
  return Math.max(0, (asOfMs - Date.parse(iso)) / 86_400_000);
}

/** Filters expressible on raw fields only (the ones the server can re-check independently). */
function matchesRawFilters(record: DatasetRecord, filters: AnalysisPlan["filters"], asOfMs: number): boolean {
  if (filters.failed_within_days !== undefined && daysSince(asOfMs, record.failed_at) > filters.failed_within_days) return false;
  if (filters.min_amount_minor !== undefined && record.amount_due < filters.min_amount_minor) return false;
  if (filters.currency !== undefined && record.currency !== filters.currency) return false;
  if (filters.failure_codes !== undefined && !filters.failure_codes.includes(record.failure_code)) return false;
  return true;
}

const EMAIL_TOKEN = /[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+/g;
const DIGIT_RUN = /\d(?:[ -]?\d){12,18}/;

function textLeaks(text: string): string | null {
  for (const token of text.match(EMAIL_TOKEN) ?? []) {
    const local = token.split("@")[0]!;
    if (!/^.\*\*\*$/.test(local)) return "email-shaped text";
  }
  if (DIGIT_RUN.test(text)) return "a 13 to 19 digit run";
  return null;
}

export function validateResult(
  parsed: unknown,
  plan: AnalysisPlan,
  records: DatasetRecord[],
  asOf: string,
): ValidationOutcome {
  const shape = analysisResultSchema.safeParse(parsed);
  if (!shape.success) {
    const issue = shape.error.issues[0];
    return fail("schema", `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`);
  }
  const result = shape.data;
  const asOfMs = Date.parse(asOf);
  const byInvoice = new Map(records.map((r) => [r.invoice_id, r]));

  if (canonical(result.plan) !== canonical(plan)) return fail("plan_echo", "The result does not echo the plan that was executed.");
  if (Date.parse(result.as_of) !== asOfMs) return fail("as_of", "as_of does not match the dataset.");
  if (result.metrics.records_total !== records.length) {
    return fail("records_total", `records_total ${result.metrics.records_total} does not match the dataset (${records.length}).`);
  }

  const seen = new Set<string>();
  const resolvedStates = new Set(["recovered", "not_recovered"]);
  const tierIndex = (p: string) => PRIORITIES.indexOf(p as (typeof PRIORITIES)[number]);
  const f = plan.filters;
  let returned = 0;

  const currenciesSeen = new Set<string>();
  for (const queue of result.queues) {
    if (currenciesSeen.has(queue.currency)) return fail("queue_currency", `Duplicate queue for ${queue.currency}.`);
    currenciesSeen.add(queue.currency);
    if (queue.items.length > plan.top_n) return fail("top_n", `Queue ${queue.currency} has more than top_n=${plan.top_n} items.`);
    let previousScore = Infinity;
    for (let i = 0; i < queue.items.length; i++) {
      const item = queue.items[i]!;
      if (item.rank !== i + 1) return fail("rank", `Queue ${queue.currency}: rank ${item.rank} at position ${i + 1}.`);
      if (item.score > previousScore) return fail("score_order", `Queue ${queue.currency}: scores are not sorted.`);
      previousScore = item.score;
      if (item.currency !== queue.currency) return fail("queue_currency", `${item.invoice_id} is in the ${queue.currency} queue but is ${item.currency}.`);
      if (resolvedStates.has(item.state)) return fail("queue_state", `${item.invoice_id} is resolved but queued.`);
      const raw = byInvoice.get(item.invoice_id);
      if (!raw) return fail("unknown_invoice", `Invoice ${item.invoice_id} does not exist in the dataset.`);
      if (seen.has(item.invoice_id)) return fail("duplicate_invoice", `Invoice ${item.invoice_id} appears twice.`);
      seen.add(item.invoice_id);
      returned++;
      if (raw.amount_due !== item.amount_minor) return fail("amount_mismatch", `${item.invoice_id}: amount does not match the dataset.`);
      if (raw.currency !== item.currency) return fail("currency_mismatch", `${item.invoice_id}: currency does not match the dataset.`);
      if (raw.customer_id !== item.customer_id) return fail("customer_mismatch", `${item.invoice_id}: customer does not match the dataset.`);
      if (raw.failure_code !== item.failure_code) return fail("failure_code_mismatch", `${item.invoice_id}: failure code does not match.`);
      if (item.customer_email_masked !== maskEmail(raw.customer_email)) return fail("masking", `${item.invoice_id}: email is not masked as required.`);
      if (!matchesRawFilters(raw, f, asOfMs)) return fail("plan_conformance", `${item.invoice_id} does not satisfy the plan filters.`);
      if (f.states && !f.states.includes(item.state)) return fail("plan_conformance", `${item.invoice_id} has state ${item.state}, outside the plan.`);
      if (f.priority_at_least && tierIndex(item.priority) < tierIndex(f.priority_at_least)) {
        return fail("plan_conformance", `${item.invoice_id} is below the priority threshold.`);
      }
      const leak = textLeaks(item.reason);
      if (leak) return fail("text_leak", `reason of ${item.invoice_id} contains ${leak}.`);
    }
  }

  for (const entry of result.resolved) {
    const raw = byInvoice.get(entry.invoice_id);
    if (!raw) return fail("unknown_invoice", `Invoice ${entry.invoice_id} does not exist in the dataset.`);
    if (seen.has(entry.invoice_id)) return fail("duplicate_invoice", `Invoice ${entry.invoice_id} appears twice.`);
    seen.add(entry.invoice_id);
    returned++;
    if (raw.amount_due !== entry.amount_minor || raw.currency !== entry.currency) {
      return fail("amount_mismatch", `${entry.invoice_id}: resolved entry does not match the dataset.`);
    }
    if (!matchesRawFilters(raw, f, asOfMs)) return fail("plan_conformance", `${entry.invoice_id} does not satisfy the plan filters.`);
    if (f.states && !f.states.includes(entry.state)) return fail("plan_conformance", `${entry.invoice_id} has state ${entry.state}, outside the plan.`);
    if (f.priority_at_least) return fail("plan_conformance", `${entry.invoice_id} has no priority but a threshold was requested.`);
    const expectedState = raw.invoice_status === "paid" ? "recovered" : "not_recovered";
    if (raw.invoice_status === "open" || entry.state !== expectedState) {
      return fail("resolved_state", `${entry.invoice_id}: resolved state does not match invoice_status ${raw.invoice_status}.`);
    }
  }

  // No silent drops or additions: for filters the server can evaluate on raw fields, the scope size must match.
  const expectedScope = records.filter((r) => matchesRawFilters(r, f, asOfMs)).length;
  const scope = result.metrics.records_in_scope;
  const rawOnly = !f.states && !f.priority_at_least;
  if (rawOnly && scope !== expectedScope) {
    return fail("plan_conformance", `records_in_scope is ${scope} but ${expectedScope} records satisfy the plan filters.`);
  }
  if (!rawOnly && scope > expectedScope) {
    return fail("plan_conformance", `records_in_scope is ${scope}, more than the ${expectedScope} records satisfying the raw filters.`);
  }
  if (returned > scope) return fail("records_in_scope", "More records were returned than records_in_scope.");

  for (const row of result.metrics.by_currency) {
    if (row.in_recovery_minor + row.action_needed_minor + row.failed_minor !== row.amount_at_risk_minor) {
      return fail("metrics", `Metrics for ${row.currency} do not add up.`);
    }
  }

  for (const text of [result.summary, ...result.warnings]) {
    const leak = textLeaks(text);
    if (leak) return fail("text_leak", `summary or warnings contain ${leak}.`);
  }

  return { ok: true, result };
}
