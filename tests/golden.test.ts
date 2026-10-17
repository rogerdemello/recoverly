import { describe, expect, it } from "vitest";
import { validateResult } from "../src/lib/agent/validate";
import { DEMO_PLAN } from "../src/lib/domain/schemas";
import { loadFixtureDataset } from "../src/lib/store";
import { golden } from "./helpers";

// Expected values come from docs/fixture-spec.md (independent reference implementation).
const A_USD = [
  ["in_synth_001", 85.0, "urgent", "update_payment_method", "high", "action_needed"],
  ["in_synth_009", 55.5, "high", "review_manually", "high", "action_needed"],
  ["in_synth_006", 52.4, "high", "contact_customer", "high", "action_needed"],
  ["in_synth_007", 40.4, "medium", "update_payment_method", "high", "action_needed"],
  ["in_synth_002", 33.9, "medium", "wait_for_retry", "high", "in_recovery"],
  ["in_synth_011", 31.7, "medium", "update_payment_method", "high", "action_needed"],
  ["in_synth_010", 30.9, "medium", "wait_for_retry", "high", "in_recovery"],
  ["in_synth_008", 29.8, "low", "review_manually", "low", "failed"],
  ["in_synth_003", 27.6, "low", "contact_customer", "high", "action_needed"],
  ["in_synth_013", 25.5, "low", "review_manually", "high", "action_needed"],
] as const;

describe("Golden A (no filters)", () => {
  const result = golden("golden-a");
  const usd = result.queues.find((q) => q.currency === "usd")!;
  const eur = result.queues.find((q) => q.currency === "eur")!;

  it("ranks the USD queue exactly as the spec says", () => {
    expect(usd.items.map((i) => i.invoice_id)).toEqual(A_USD.map((r) => r[0]));
    A_USD.forEach(([id, score, priority, action, confidence, state], i) => {
      const item = usd.items[i]!;
      expect(item.rank).toBe(i + 1);
      expect(Math.abs(item.score - score), id).toBeLessThanOrEqual(0.05);
      expect(item.priority, id).toBe(priority);
      expect(item.recommended_action, id).toBe(action);
      expect(item.confidence, id).toBe(confidence);
      expect(item.state, id).toBe(state);
    });
  });

  it("matches component values within tolerance (spot checks)", () => {
    const first = usd.items[0]!.components;
    expect(first.amount_norm).toBeCloseTo(1, 3);
    expect(first.recovery).toBeCloseTo(0.9, 3);
    expect(Math.abs(first.urgency - 0.377)).toBeLessThanOrEqual(0.0015);
    expect(first.value).toBeCloseTo(1, 3);
    expect(Math.abs(usd.items[3]!.components.value - 0.684)).toBeLessThanOrEqual(0.0015); // 007: young customer
    expect(Math.abs(usd.items[5]!.components.value - 0.029)).toBeLessThanOrEqual(0.0015); // 011: brand new
  });

  it("keeps the single EUR item separate with its warning", () => {
    expect(eur.items).toHaveLength(1);
    expect(eur.items[0]!.invoice_id).toBe("in_synth_012");
    expect(Math.abs(eur.items[0]!.score - 84.9)).toBeLessThanOrEqual(0.05);
    expect(result.warnings).toContain("single_item_currency:eur");
    expect(result.data_quality.single_item_currencies).toEqual(["eur"]);
  });

  it("lists resolved invoices and never queues them", () => {
    expect(result.resolved.map((r) => [r.invoice_id, r.state, r.reason])).toEqual([
      ["in_synth_004", "recovered", "Invoice is paid."],
      ["in_synth_005", "not_recovered", "Invoice is uncollectible."],
    ]);
    const queued = result.queues.flatMap((q) => q.items.map((i) => i.invoice_id));
    expect(queued).not.toContain("in_synth_004");
    expect(queued).not.toContain("in_synth_005");
  });

  it("matches the metrics table", () => {
    expect(result.metrics.records_total).toBe(13);
    expect(result.metrics.records_in_scope).toBe(13);
    const usdM = result.metrics.by_currency.find((m) => m.currency === "usd")!;
    expect(usdM).toMatchObject({
      failed_count: 10,
      affected_customers: 10,
      amount_at_risk_minor: 149100,
      in_recovery_minor: 14800,
      action_needed_minor: 114400,
      failed_minor: 19900,
    });
    const eurM = result.metrics.by_currency.find((m) => m.currency === "eur")!;
    expect(eurM).toMatchObject({
      failed_count: 1,
      affected_customers: 1,
      amount_at_risk_minor: 9900,
      in_recovery_minor: 0,
      action_needed_minor: 9900,
      failed_minor: 0,
    });
    const code = (cur: string, c: string) => result.metrics.by_failure_code.find((r) => r.currency === cur && r.failure_code === c);
    expect(code("usd", "generic_decline")).toMatchObject({ count: 3, amount_minor: 53800 });
    expect(code("usd", "expired_card")).toMatchObject({ count: 2, amount_minor: 52800 });
    expect(code("usd", "insufficient_funds")).toMatchObject({ count: 3, amount_minor: 27700 });
    expect(code("usd", "authentication_required")).toMatchObject({ count: 1, amount_minor: 7900 });
    expect(code("usd", "lost_card")).toMatchObject({ count: 1, amount_minor: 6900 });
    expect(code("eur", "expired_card")).toMatchObject({ count: 1, amount_minor: 9900 });
  });

  it("matches data quality", () => {
    expect(result.data_quality).toEqual({
      records_with_missing_inputs: 1,
      unrecognized_failure_codes: [],
      currencies: ["usd", "eur"],
      single_item_currencies: ["eur"],
    });
    expect(usd.items.find((i) => i.invoice_id === "in_synth_008")!.missing_inputs).toEqual([
      "failure_message",
      "customer_created_at",
      "subscription_id",
      "hosted_invoice_url",
      "next_payment_attempt",
    ]);
  });

  it("passes server-side validation against the raw dataset", () => {
    const ds = loadFixtureDataset();
    const verdict = validateResult(result, result.plan, ds.records, ds.asOf);
    expect(verdict).toMatchObject({ ok: true });
  });
});

describe("Golden B (the demo question)", () => {
  const result = golden("golden-b");
  const usd = result.queues.find((q) => q.currency === "usd")!;

  it("filters to the last seven days and keeps scores unchanged", () => {
    expect(usd.items.map((i) => [i.invoice_id, i.score, i.priority, i.recommended_action])).toEqual([
      ["in_synth_001", 85.0, "urgent", "update_payment_method"],
      ["in_synth_009", 55.5, "high", "review_manually"],
      ["in_synth_007", 40.4, "medium", "update_payment_method"],
      ["in_synth_002", 33.9, "medium", "wait_for_retry"],
      ["in_synth_011", 31.7, "medium", "update_payment_method"],
      ["in_synth_010", 30.9, "medium", "wait_for_retry"],
      ["in_synth_008", 29.8, "low", "review_manually"],
      ["in_synth_003", 27.6, "low", "contact_customer"],
      ["in_synth_013", 25.5, "low", "review_manually"],
    ]);
    expect(result.queues.find((q) => q.currency === "eur")!.items[0]).toMatchObject({
      invoice_id: "in_synth_012",
      priority: "urgent",
      recommended_action: "update_payment_method",
    });
  });

  it("excludes 005 and 006 and reports the right scope and metrics", () => {
    const ids = result.queues.flatMap((q) => q.items.map((i) => i.invoice_id));
    expect(ids).not.toContain("in_synth_005");
    expect(ids).not.toContain("in_synth_006");
    expect(result.metrics.records_total).toBe(13);
    expect(result.metrics.records_in_scope).toBe(11);
    expect(result.resolved.map((r) => r.invoice_id)).toEqual(["in_synth_004"]);
    expect(result.metrics.by_currency.find((m) => m.currency === "usd")).toMatchObject({
      failed_count: 9,
      affected_customers: 9,
      amount_at_risk_minor: 136200,
      in_recovery_minor: 14800,
    });
    expect(result.metrics.by_currency.find((m) => m.currency === "eur")).toMatchObject({
      failed_count: 1,
      affected_customers: 1,
      amount_at_risk_minor: 9900,
      in_recovery_minor: 0,
    });
  });

  it("shows that the highest amount is not the most recoverable (009 vs 007)", () => {
    const item = (id: string) => usd.items.find((i) => i.invoice_id === id)!;
    expect(item("in_synth_009").amount_minor).toBeGreaterThan(item("in_synth_007").amount_minor);
    expect(item("in_synth_009").components.recovery).toBeLessThan(item("in_synth_007").components.recovery);
  });

  it("echoes the demo plan and passes validation", () => {
    const ds = loadFixtureDataset();
    expect(validateResult(result, DEMO_PLAN, ds.records, ds.asOf)).toMatchObject({ ok: true });
  });

  it("never exposes a raw email", () => {
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/ava\.stone@/);
    expect(text).toMatch(/a\*\*\*@example\.test/);
  });

  it("carries deterministic reasons and fact/inference evidence", () => {
    const top = usd.items[0]!;
    expect(top.reason).toContain("Card has expired; customer must supply a new card.");
    expect(top.reason).toContain("No retry is scheduled.");
    expect(top.evidence.filter((e) => e.source === "stripe_fact").map((e) => e.field)).toContain("amount_due");
    expect(top.evidence.filter((e) => e.source === "agent_inference").map((e) => e.field)).toContain("priority");
  });
});
