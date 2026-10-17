import { describe, expect, it } from "vitest";
import { validateResult } from "../src/lib/agent/validate";
import { DEMO_PLAN, type AnalysisResult } from "../src/lib/domain/schemas";
import { loadFixtureDataset } from "../src/lib/store";
import { clone, golden } from "./helpers";

const ds = loadFixtureDataset();
const check = (result: unknown, plan = DEMO_PLAN) => validateResult(result, plan, ds.records, ds.asOf);
const usdOf = (r: AnalysisResult) => r.queues.find((q) => q.currency === "usd")!;

function expectRejected(mutate: (r: AnalysisResult) => void, checkName: string, plan = DEMO_PLAN) {
  const r = clone(golden("golden-b"));
  mutate(r);
  const verdict = check(r, plan);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.check).toBe(checkName);
}

describe("validateResult", () => {
  it("accepts a correct result", () => {
    expect(check(golden("golden-b"))).toMatchObject({ ok: true });
  });

  it("rejects non-objects and wrong shapes", () => {
    expect(check("nope")).toMatchObject({ ok: false, check: "schema" });
    expect(check({ schema_version: "1" })).toMatchObject({ ok: false, check: "schema" });
  });

  it("rejects wrong ranks", () => expectRejected((r) => { usdOf(r).items[1]!.rank = 5; }, "rank"));
  it("rejects unsorted scores", () => expectRejected((r) => { usdOf(r).items[2]!.score = 99; }, "score_order"));
  it("rejects negative minor units", () => expectRejected((r) => { usdOf(r).items[0]!.amount_minor = -1; }, "schema"));
  it("rejects non-integer minor units", () => expectRejected((r) => { usdOf(r).items[0]!.amount_minor = 49900.5; }, "schema"));
  it("rejects an invented invoice", () => expectRejected((r) => { usdOf(r).items[0]!.invoice_id = "in_fake_999"; }, "unknown_invoice"));
  it("rejects a cross-currency item", () => expectRejected((r) => { usdOf(r).items[0]!.currency = "eur"; }, "queue_currency"));
  it("rejects altered amounts", () => expectRejected((r) => { usdOf(r).items[0]!.amount_minor = 100; }, "amount_mismatch"));
  it("rejects a record that violates the plan filters", () =>
    expectRejected((r) => {
      // in_synth_006 failed 8 days ago, outside the 7-day window.
      usdOf(r).items[0]!.invoice_id = "in_synth_006";
      usdOf(r).items[0]!.amount_minor = 12900;
      usdOf(r).items[0]!.customer_id = "cus_synth_006";
      usdOf(r).items[0]!.failure_code = "insufficient_funds";
      usdOf(r).items[0]!.customer_email_masked = "f***@example.test";
    }, "plan_conformance"));
  it("rejects a script that silently dropped in-scope records", () =>
    expectRejected((r) => { r.metrics.records_in_scope = 9; }, "plan_conformance"));
  it("rejects more items than top_n", () =>
    expectRejected((r) => { r.plan.top_n = 3; }, "top_n", { ...DEMO_PLAN, top_n: 3 }));
  it("rejects a result that does not echo the executed plan", () => expectRejected((r) => { r.plan.filters = { failed_within_days: 30 }; }, "plan_echo"));
  it("rejects a wrong records_total", () => expectRejected((r) => { r.metrics.records_total = 12; }, "records_total"));
  it("rejects a raw email in a text field", () => expectRejected((r) => { usdOf(r).items[0]!.reason = "Contact ava.stone@example.test"; }, "text_leak"));
  it("allows masked emails in text", () => {
    const r = clone(golden("golden-b"));
    r.summary = "Top customer a***@example.test needs a new card.";
    expect(check(r)).toMatchObject({ ok: true });
  });
  it("rejects a long digit run in warnings", () => expectRejected((r) => { r.warnings.push("card 4242424242424242"); }, "text_leak"));
  it("rejects an unmasked email column", () => expectRejected((r) => { usdOf(r).items[0]!.customer_email_masked = "ava.stone@example.test"; }, "masking"));
  it("rejects metrics that do not add up", () => expectRejected((r) => { r.metrics.by_currency[0]!.in_recovery_minor += 1; }, "metrics"));
  it("rejects a resolved item that is still open", () =>
    expectRejected((r) => { r.resolved.push({ invoice_id: "in_synth_001", customer_id: "cus_synth_001", currency: "usd", amount_minor: 49900, state: "recovered", recommended_action: "do_not_pursue", reason: "x" }); }, "duplicate_invoice"));

  it("handles the unfiltered plan too", () => {
    const a = golden("golden-a");
    expect(validateResult(a, a.plan, ds.records, ds.asOf)).toMatchObject({ ok: true });
  });

  it("enforces state and priority filters", () => {
    const a = clone(golden("golden-a"));
    a.plan = { ...a.plan, filters: { states: ["in_recovery"] } };
    expect(validateResult(a, a.plan, ds.records, ds.asOf)).toMatchObject({ ok: false, check: "plan_conformance" });
    const b = clone(golden("golden-a"));
    b.plan = { ...b.plan, filters: { priority_at_least: "urgent" } };
    expect(validateResult(b, b.plan, ds.records, ds.asOf)).toMatchObject({ ok: false, check: "plan_conformance" });
  });
});
