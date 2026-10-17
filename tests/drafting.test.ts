import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { LlmUnavailableError, setLlmForTesting, type Llm } from "../src/lib/agent/llm";
import { formatMoney } from "../src/lib/domain/money";
import { TONES } from "../src/lib/domain/schemas";
import { checksPass, issueLine, renderTemplate, runChecks } from "../src/lib/drafting/checks";
import { approveDraft, createDraft, listAudit, setDeliveryAdapter } from "../src/lib/drafting/service";
import { ApiError } from "../src/lib/errors";
import { loadFixtureDataset, resetStoreForTests, saveAnalysis } from "../src/lib/store";
import { golden } from "./helpers";

const ds = loadFixtureDataset();
const result = golden("golden-a");
const items = result.queues.flatMap((q) => q.items);

function ctxFor(invoiceId: string) {
  const item = items.find((i) => i.invoice_id === invoiceId)!;
  const raw = ds.records.find((r) => r.invoice_id === invoiceId)!;
  return {
    item,
    raw,
    ctx: {
      amount: formatMoney(item.amount_minor, item.currency),
      hostedInvoiceUrl: raw.hosted_invoice_url,
      support: "support@example.test",
      failureCode: raw.failure_code,
      failureMessage: raw.failure_message,
      score: item.score.toFixed(1),
    },
  };
}

describe("templates and content checks", () => {
  const eligible = items.filter((i) => ["update_payment_method", "contact_customer", "review_manually"].includes(i.recommended_action));

  it("every template passes every check for every draft-eligible fixture row", () => {
    expect(eligible.length).toBeGreaterThan(5);
    for (const item of eligible) {
      const { raw, ctx } = ctxFor(item.invoice_id);
      for (const tone of TONES) {
        const msg = renderTemplate(tone, {
          business: "Acme Cloud (demo)",
          invoiceId: item.invoice_id,
          amount: ctx.amount,
          issue: issueLine(raw.failure_code),
          hostedInvoiceUrl: raw.hosted_invoice_url,
          support: ctx.support,
        });
        const failed = runChecks(msg.subject, msg.body, ctx).filter((c) => !c.ok).map((c) => c.name);
        expect(failed, `${item.invoice_id}/${tone}`).toEqual([]);
      }
    }
  });

  it("uses generic wording for the non-disclosable set", () => {
    for (const code of ["lost_card", "stolen_card", "fraudulent", "merchant_blacklist", "pickup_card", "restricted_card"]) {
      expect(issueLine(code)).toBe("We were unable to process the payment.");
    }
    expect(issueLine("expired_card")).toBe("The card we have on file has expired.");
    expect(issueLine("authentication_required")).toBe("Your bank needs you to confirm this payment.");
  });

  const base = () => ctxFor("in_synth_001");
  const message = (tone: "concise" = "concise") => {
    const { ctx, raw } = base();
    return renderTemplate(tone, { business: "Acme Cloud (demo)", invoiceId: "in_synth_001", amount: ctx.amount, issue: issueLine(raw.failure_code), hostedInvoiceUrl: raw.hosted_invoice_url, support: ctx.support });
  };
  const failing = (subject: string, body: string, ctx = base().ctx) => runChecks(subject, body, ctx).filter((c) => !c.ok).map((c) => c.name);

  it.each([
    ["suspend", "We may suspend your account."],
    ["terminat", "Your plan could be terminated."],
    ["legal", "We will take legal action."],
    ["immediately", "Please pay immediately."],
    ["guarantee", "We guarantee it works."],
  ])("flags threat wording: %s", (_n, extra) => {
    const m = message();
    expect(failing(m.subject, `${m.body}\n${extra}`)).toContain("no_threats");
  });

  it("flags missing amount, support and link", () => {
    const m = message();
    expect(failing(m.subject, m.body.replace("$499.00", "some money"))).toContain("amount_present");
    expect(failing(m.subject, m.body.replaceAll("support@example.test", "us"))).toContain("support_present");
    expect(failing(m.subject, m.body.replace("https://example.test/hosted-invoice/in_synth_001", "https://example.test/hosted-invoice/other"))).toContain("link_or_support");
  });

  it("flags card numbers, stray contacts, placeholders and internal data", () => {
    const m = message();
    expect(failing(m.subject, `${m.body}\n4242 4242 4242 4242`)).toContain("no_card_numbers");
    expect(failing(m.subject, `${m.body}\nWrite to boss@evil.test`)).toContain("no_stray_contacts");
    expect(failing(m.subject, `${m.body}\nSee https://evil.test/x`)).toContain("no_stray_contacts");
    expect(failing(m.subject, `${m.body}\n{{business}}`)).toContain("no_placeholders");
    expect(failing(m.subject, `${m.body}\nCode: expired_card`)).toContain("no_internal_data");
    expect(failing(m.subject, `${m.body}\nYour score is 85.0`)).toContain("no_internal_data");
    expect(failing("x".repeat(81), m.body)).toContain("length");
  });

  it("does not mistake the amount for the score", () => {
    const { ctx } = ctxFor("in_synth_012"); // score 84.9; amount €99.00
    const m = renderTemplate("concise", { business: "B", invoiceId: "in_synth_012", amount: ctx.amount, issue: "x.", hostedInvoiceUrl: ctx.hostedInvoiceUrl, support: ctx.support });
    expect(failing(m.subject, m.body, ctx)).not.toContain("no_internal_data");
  });

  it("blocks disclosure words for a non-disclosable code", () => {
    const { ctx } = ctxFor("in_synth_013");
    expect(ctx.failureCode).toBe("lost_card");
    expect(failing("Subject", `${ctx.amount} ${ctx.support} ${ctx.hostedInvoiceUrl} Your card was reported stolen.`, ctx)).toContain("non_disclosure");
  });

  it("requires no URL when the invoice has no hosted link", () => {
    const { ctx } = ctxFor("in_synth_008");
    const noLink = renderTemplate("friendly", { business: "B", invoiceId: "in_synth_008", amount: ctx.amount, issue: "x.", hostedInvoiceUrl: "", support: ctx.support });
    expect(noLink.body).toContain("get in touch");
    expect(checksPass(runChecks(noLink.subject, noLink.body, ctx))).toBe(true);
    expect(failing(noLink.subject, `${noLink.body} https://example.test/a`, ctx)).toContain("link_or_support");
  });

  it("does not re-expand placeholders found inside values", () => {
    const m = renderTemplate("concise", { business: "{{support}}", invoiceId: "i", amount: "$1.00", issue: "x.", hostedInvoiceUrl: "", support: "s@example.test" });
    expect(m.body).toContain("{{support}}");
  });
});

describe("draft and approval flow", () => {
  beforeEach(() => {
    resetStoreForTests();
    setDeliveryAdapter(null);
    delete process.env.RECOVERLY_ENABLE_SEND;
    // The provider is down, so the deterministic template fallback is used.
    setLlmForTesting({ json: async () => { throw new LlmUnavailableError("down"); }, text: async () => { throw new LlmUnavailableError("down"); } });
    saveAnalysis({ analysisId: "an_1", datasetId: "fixture", question: "q", result });
  });
  afterEach(() => {
    setLlmForTesting(null);
    setDeliveryAdapter(null);
    delete process.env.RECOVERLY_ENABLE_SEND;
  });

  it("creates a checked draft addressed to a masked recipient", async () => {
    const view = await createDraft("an_1", "in_synth_001", "friendly");
    expect(view.source).toBe("template");
    expect(view.toMasked).toBe("a***@example.test");
    expect(view.body).toContain("$499.00");
    expect(view.body).toContain("https://example.test/hosted-invoice/in_synth_001");
    expect(view.body).toContain("The card we have on file has expired.");
    expect(view.checks.every((c) => c.ok)).toBe(true);
    expect(view.delivery.mode).toBe("disabled");
    expect(JSON.stringify(view)).not.toContain("ava.stone@example.test");
    expect(view.body).not.toContain("expired_card");
    expect(view.approval.nonce).toHaveLength(48);
  });

  it("uses a valid LLM draft when it passes the checks", async () => {
    const llm: Llm = {
      json: async () => JSON.stringify({ subject: "About your Acme Cloud (demo) payment", body: "Hi,\n\nThe card we have on file has expired. Invoice in_synth_001 for $499.00 is unpaid. Pay securely here: https://example.test/hosted-invoice/in_synth_001\nQuestions? support@example.test\n\nAcme Cloud (demo)" }),
      text: async () => "",
    };
    setLlmForTesting(llm);
    expect((await createDraft("an_1", "in_synth_001", "concise")).source).toBe("llm");
  });

  it("regenerates once, then falls back to the template when the LLM keeps failing the checks", async () => {
    let calls = 0;
    setLlmForTesting({
      json: async () => { calls++; return JSON.stringify({ subject: "Final notice", body: "We will suspend you immediately. Pay $499.00" }); },
      text: async () => "",
    });
    const view = await createDraft("an_1", "in_synth_001", "concise");
    expect(calls).toBe(2);
    expect(view.source).toBe("template");
    expect(view.checks.every((c) => c.ok)).toBe(true);
  });

  it("never sends the LLM customer data", async () => {
    const seen: string[] = [];
    setLlmForTesting({ json: async (s, u) => { seen.push(s, u); throw new LlmUnavailableError("down"); }, text: async () => "" });
    await createDraft("an_1", "in_synth_009", "concise");
    const prompt = seen.join("\n");
    for (const banned of ["ivan.cole", "example.test/hosted-invoice/in_synth_009".length ? "generic_decline" : "", "cus_synth_009", "55.5", "Your card was declined"]) {
      expect(prompt).not.toContain(banned);
    }
    expect(prompt).toContain("We were unable to process the payment.");
  });

  it("refuses ineligible actions and resolved invoices", async () => {
    await expect(createDraft("an_1", "in_synth_002", "concise")).rejects.toMatchObject({ code: "DRAFT_NOT_ELIGIBLE" }); // wait_for_retry
    await expect(createDraft("an_1", "in_synth_004", "concise")).rejects.toMatchObject({ code: "DRAFT_NOT_ELIGIBLE" }); // paid
    await expect(createDraft("an_1", "in_missing", "concise")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(createDraft("an_missing", "in_synth_001", "concise")).rejects.toMatchObject({ code: "ANALYSIS_NOT_FOUND" });
  });

  it("approves once with the nonce, sends nothing, and audits without the message body", async () => {
    const view = await createDraft("an_1", "in_synth_001", "concise");
    const done = await approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true });
    expect(done.status).toBe("approved_not_sent");
    const audit = listAudit();
    expect(audit.map((a) => a.action)).toEqual(["draft_approved", "draft_generated"]);
    const text = JSON.stringify(audit);
    expect(text).not.toContain(view.body.slice(0, 20));
    expect(text).not.toContain("ava.stone@example.test");
    expect(audit[0]).toMatchObject({ deliveryStatus: "not_attempted", actor: "operator", toMasked: "a***@example.test" });
    expect(audit[0]!.messageSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects replayed, wrong and missing approvals and records the rejection", async () => {
    const view = await createDraft("an_1", "in_synth_001", "concise");
    await expect(approveDraft(view.draftId, { nonce: "nope", confirm: true })).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await expect(approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: "true" })).rejects.toBeInstanceOf(ApiError);
    await approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true });
    await expect(approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true })).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    expect(listAudit().filter((a) => a.action === "approval_rejected")).toHaveLength(3);
    expect(listAudit().filter((a) => a.action === "draft_approved")).toHaveLength(1);
    await expect(approveDraft("dr_missing", { nonce: "x", confirm: true })).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
  });

  it("re-checks an edited body and accepts a clean edit", async () => {
    const view = await createDraft("an_1", "in_synth_001", "concise");
    await expect(approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true, editedBody: "Pay now or we suspend you." })).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    const edited = `${view.body}\nThanks for being a customer.`;
    const done = await approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true, editedBody: edited });
    expect(done.message.body).toBe(edited);
  });

  it("expires the approval window", async () => {
    const view = await createDraft("an_1", "in_synth_001", "concise");
    const realNow = Date.now;
    Date.now = () => realNow() + 31 * 60 * 1000;
    try {
      await expect(approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true })).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    } finally {
      Date.now = realNow;
    }
  });

  it("with delivery enabled, a failing adapter preserves the draft for retry", async () => {
    process.env.RECOVERLY_ENABLE_SEND = "true";
    let attempts = 0;
    setDeliveryAdapter({ send: async () => { if (++attempts === 1) throw new Error("smtp down"); } });
    const view = await createDraft("an_1", "in_synth_001", "concise");
    expect(view.delivery.mode).toBe("enabled");
    const first = await approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true });
    expect(first.status).toBe("send_failed");
    const second = await approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true });
    expect(second.status).toBe("sent");
    expect(listAudit().map((a) => a.action)).toEqual(["draft_approved", "send_failed", "draft_generated"]);
  });

  it("with delivery enabled but no adapter, reports send_failed", async () => {
    process.env.RECOVERLY_ENABLE_SEND = "true";
    const view = await createDraft("an_1", "in_synth_001", "concise");
    expect((await approveDraft(view.draftId, { nonce: view.approval.nonce, confirm: true })).status).toBe("send_failed");
  });
});
