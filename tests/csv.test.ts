import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { maskEmail, parseCsv, toSandboxData, tokenizeCsv } from "../src/lib/domain/csv";

const HEADER =
  "customer_id,customer_email,invoice_id,subscription_id,amount_due,currency,failure_code,failure_message,failed_at,attempt_count,next_payment_attempt,invoice_status,customer_created_at,hosted_invoice_url";

function row(over: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    customer_id: "cus_1",
    customer_email: "ava@example.test",
    invoice_id: "in_1",
    subscription_id: "sub_1",
    amount_due: "1000",
    currency: "usd",
    failure_code: "expired_card",
    failure_message: "Your card has expired.",
    failed_at: "2026-10-15T08:10:00Z",
    attempt_count: "1",
    next_payment_attempt: "",
    invoice_status: "open",
    customer_created_at: "2024-09-02T00:00:00Z",
    hosted_invoice_url: "https://example.test/i/1",
    ...over,
  };
  return HEADER.split(",").map((c) => base[c] ?? "").join(",");
}

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("fixture CSV", () => {
  const text = readFileSync(path.join(process.cwd(), "data", "fixtures", "failed_payments.csv"), "utf8");
  const parsed = parseCsv(text);

  it("parses all 13 rows", () => {
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.records).toHaveLength(13);
      expect(parsed.records[0]).toMatchObject({ invoice_id: "in_synth_001", amount_due: 49900, currency: "usd", next_payment_attempt: "" });
      const r8 = parsed.records.find((r) => r.invoice_id === "in_synth_008")!;
      expect(r8.next_payment_attempt).toBe("unknown");
      expect(r8.subscription_id).toBe("");
      expect(r8.hosted_invoice_url).toBe("");
    }
  });

  it("sends only masked emails to the sandbox", () => {
    if (!parsed.ok) throw new Error("fixture invalid");
    const data = toSandboxData("2026-10-17T12:00:00Z", parsed.records);
    expect(JSON.stringify(data)).not.toContain("ava.stone@example.test");
    expect(data.records[0]!.customer_email_masked).toBe("a***@example.test");
    expect(Object.keys(data.records[0]!)).not.toContain("customer_email");
  });
});

describe("masking", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("ava.stone@example.test")).toBe("a***@example.test");
    expect(maskEmail("")).toBe("");
  });
});

describe("invalid CSV (fixture-spec section 7)", () => {
  const problemOf = (text: string) => {
    const res = parseCsv(text);
    if (res.ok) throw new Error("expected rejection");
    return res.problems;
  };

  it("missing required column", () => {
    const text = csv(row()).replace("amount_due,", "amt,");
    expect(problemOf(text)[0]).toMatchObject({ column: "amount_due", problem: "missing_column" });
  });

  it.each([["49.90"], ["abc"], [""]])("amount %j is not an integer", (v) => {
    expect(problemOf(csv(row({ amount_due: v })))[0]).toMatchObject({ row: 1, column: "amount_due", problem: "not_integer" });
  });

  it("negative amount", () => {
    expect(problemOf(csv(row({ amount_due: "-5" })))[0]).toMatchObject({ column: "amount_due", problem: "negative_amount" });
  });

  it("invalid currency", () => {
    expect(problemOf(csv(row({ currency: "dollars" })))[0]).toMatchObject({ column: "currency", problem: "invalid_currency" });
  });

  it("invalid status (draft is rejected)", () => {
    expect(problemOf(csv(row({ invoice_status: "draft" })))[0]).toMatchObject({ column: "invoice_status", problem: "invalid_status" });
  });

  it("invalid timestamp", () => {
    expect(problemOf(csv(row({ failed_at: "yesterday" })))[0]).toMatchObject({ column: "failed_at", problem: "invalid_timestamp" });
  });

  it.each([["-1"], ["1.5"], ["x"]])("invalid attempt_count %j", (v) => {
    expect(problemOf(csv(row({ attempt_count: v })))[0]).toMatchObject({ column: "attempt_count", problem: "invalid_attempt_count" });
  });

  it("duplicate invoice id reports the second row", () => {
    const problems = problemOf(csv(row(), row()));
    expect(problems[0]).toMatchObject({ row: 2, column: "invoice_id", problem: "duplicate_invoice_id" });
  });

  it("too many rows", () => {
    const many = csv(...Array.from({ length: 5001 }, (_, i) => row({ invoice_id: `in_${i}` })));
    expect(problemOf(many)[0]).toMatchObject({ problem: "too_large" });
  });

  it("file larger than 1 MB", () => {
    expect(problemOf(csv(row({ failure_message: "x".repeat(1_100_000) })))[0]).toMatchObject({ problem: "too_large" });
  });

  it("PAN-like value is rejected and never echoed", () => {
    const problems = problemOf(csv(row({ failure_message: "card 4242 4242 4242 4242 declined" })));
    expect(problems[0]).toMatchObject({ column: "failure_message", problem: "possible_card_number" });
    expect(JSON.stringify(problems)).not.toContain("4242");
  });

  it("reports at most 20 problems", () => {
    const bad = csv(...Array.from({ length: 40 }, (_, i) => row({ invoice_id: `in_${i}`, amount_due: "x" })));
    expect(problemOf(bad)).toHaveLength(20);
  });

  it("flags rows with the wrong number of columns", () => {
    expect(problemOf(`${HEADER}\ncus_1,only,three`)[0]).toMatchObject({ row: 1, problem: "column_count_mismatch" });
  });
});

describe("hostile but valid cells", () => {
  it("accepts a leading = + - @ as inert text", () => {
    const res = parseCsv(csv(row({ failure_message: '"=HYPERLINK(""http://evil.test"",""x"")"' })));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records[0]!.failure_message).toBe('=HYPERLINK("http://evil.test","x")');
  });

  it("handles quoted commas, quotes and newlines, CRLF and a BOM", () => {
    const text = `﻿${HEADER}\r\n${row({ failure_message: '"Declined, then ""retried""\nlater"' })}\r\n`;
    const res = parseCsv(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.records[0]!.failure_message).toBe('Declined, then "retried"\nlater');
  });

  it("tokenizes without evaluating anything", () => {
    expect(tokenizeCsv('a,b\n"1,2",3')).toEqual([["a", "b"], ["1,2", "3"]]);
  });

  it("normalizes timestamps with an offset to UTC", () => {
    const res = parseCsv(csv(row({ failed_at: "2026-10-15T10:10:00+02:00" })));
    expect(res.ok && res.records[0]!.failed_at).toBe("2026-10-15T08:10:00Z");
  });
});
