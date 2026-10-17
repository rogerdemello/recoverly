import { describe, expect, it } from "vitest";
import { guardGeneratedCode } from "../src/lib/analysis/guard";
import { analysisPlanSchema, analysisResultSchema } from "../src/lib/analysis/schemas";
import { sanitizeForSandbox } from "../src/lib/analysis/agent";

describe("guardGeneratedCode", () => {
  it("accepts a benign script that prints JSON", () => {
    const ok = guardGeneratedCode(`import json\nfrom recoverly_lib import load_records\nprint(json.dumps({"ok": True}))`);
    expect(ok.ok).toBe(true);
  });

  it("rejects network imports", () => {
    for (const bad of ["import socket", "import subprocess", "import urllib.request", "import requests", "import os", "import shutil", "import pathlib"]) {
      const res = guardGeneratedCode(`${bad}\nprint("{}")`);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects scripts without a print call", () => {
    const res = guardGeneratedCode("x = 1");
    expect(res.ok).toBe(false);
  });

  it("rejects oversized scripts", () => {
    const res = guardGeneratedCode(`print("{}")\n${"# pad".repeat(3000)}`);
    expect(res.ok).toBe(false);
  });
});

describe("analysisPlanSchema", () => {
  it("applies defaults for rank_by and top_n", () => {
    const plan = analysisPlanSchema.parse({
      question: "top failures?",
      intent: "rank_recoverable",
      metrics: ["failed_count"],
      rationale: "demo",
    });
    expect(plan.rank_by).toBe("priority_score");
    expect(plan.top_n).toBe(10);
    expect(plan.filters).toEqual({});
  });

  it("rejects unknown intent", () => {
    expect(() =>
      analysisPlanSchema.parse({
        question: "q",
        intent: "exfiltrate",
        metrics: ["failed_count"],
        rationale: "r",
      }),
    ).toThrow();
  });
});

describe("analysisResultSchema", () => {
  const rankedItem = {
    rank: 1,
    customer_id: "cus_1",
    invoice_id: "in_1",
    amount_due: 10000,
    currency: "usd",
    failure_code: "expired_card",
    invoice_status: "open",
    priority: "urgent",
    priority_score: 0.9,
    confidence: 1,
    score_components: { amount: 0.4, recovery: 0.2, urgency: 0.2, customer_value: 0.1 },
    recommended_action: "update_payment_method",
  };

  it("accepts a minimal valid result", () => {
    const res = analysisResultSchema.parse({
      summary: "ok",
      metrics: {
        total_failed_count: 1,
        total_customer_count: 1,
        by_currency: { usd: { amount_at_risk_minor: 10000, failed_count: 1, customer_count: 1 } },
        by_failure_code: { expired_card: { count: 1, amount_by_currency: { usd: 10000 } } },
        by_recovery_status: { action_needed: { count: 1, amount_by_currency: { usd: 10000 } } },
      },
      ranked_items: [rankedItem],
    });
    expect(res.ranked_items).toHaveLength(1);
    expect(res.warnings).toEqual([]);
  });

  it("allows an empty ranked queue", () => {
    const res = analysisResultSchema.parse({
      summary: "no matches",
      metrics: {
        total_failed_count: 0,
        total_customer_count: 0,
        by_currency: {},
        by_failure_code: {},
        by_recovery_status: {},
      },
      ranked_items: [],
      warnings: ["No records matched filters"],
    });
    expect(res.ranked_items).toEqual([]);
  });

  it("passes through extra keys on ranked items", () => {
    const res = analysisResultSchema.parse({
      summary: "ok",
      metrics: {
        total_failed_count: 1,
        total_customer_count: 1,
        by_currency: { usd: { amount_at_risk_minor: 10000, failed_count: 1, customer_count: 1 } },
        by_failure_code: {},
        by_recovery_status: {},
      },
      ranked_items: [{ ...rankedItem, failed_at: "2026-10-16T00:00:00Z" }],
    });
    expect((res.ranked_items[0]!).failed_at).toBe("2026-10-16T00:00:00Z");
  });

  it("rejects an invalid recommended_action", () => {
    expect(() =>
      analysisResultSchema.parse({
        summary: "ok",
        metrics: {
          total_failed_count: 1,
          total_customer_count: 1,
          by_currency: { usd: { amount_at_risk_minor: 10000, failed_count: 1, customer_count: 1 } },
          by_failure_code: {},
          by_recovery_status: {},
        },
        ranked_items: [{ ...rankedItem, recommended_action: "hack_stripe" }],
      }),
    ).toThrow();
  });
});

describe("sanitizeForSandbox", () => {
  it("strips customer_email and reports it", () => {
    const { records, stripped } = sanitizeForSandbox({
      dataset_id: "d",
      synthetic: true,
      records: [{ customer_id: "c1", customer_email: "a@b.example", amount_due: 100 }],
    });
    expect(stripped).toEqual(["customer_email"]);
    expect(records[0]).not.toHaveProperty("customer_email");
    expect(records[0]!.customer_id).toBe("c1");
  });
});
