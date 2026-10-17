/** Content checks (ui-and-drafting-spec 4.1) and deterministic templates (4.2). */
import type { Tone } from "../domain/schemas";

export const NON_DISCLOSABLE = new Set([
  "lost_card",
  "stolen_card",
  "fraudulent",
  "merchant_blacklist",
  "pickup_card",
  "restricted_card",
]);

export interface CheckContext {
  amount: string;
  hostedInvoiceUrl: string;
  support: string;
  failureCode: string;
  failureMessage: string;
  score: string;
}

export interface CheckResult {
  name: string;
  ok: boolean;
}

const THREATS = [
  "suspend",
  "terminat",
  "legal",
  "lawsuit",
  "collections",
  "final notice",
  "penalt",
  "immediately",
  "urgent action",
  "guarantee",
  "will succeed",
  "will be charged",
];

const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

function trimUrl(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

export function runChecks(subject: string, body: string, ctx: CheckContext): CheckResult[] {
  const all = `${subject}\n${body}`;
  const lower = all.toLowerCase();
  const results: CheckResult[] = [];
  const add = (name: string, ok: boolean) => results.push({ name, ok });

  add("length", subject.length > 0 && subject.length <= 80 && body.length > 0 && body.length <= 1200);
  add("amount_present", body.includes(ctx.amount));
  add(
    "link_or_support",
    ctx.hostedInvoiceUrl ? body.includes(ctx.hostedInvoiceUrl) : !/https?:\/\//i.test(all) && !/\bwww\./i.test(all),
  );
  add("support_present", body.includes(ctx.support));
  add("no_card_numbers", !/\d(?:[ -]?\d){12,18}/.test(all));
  add("no_threats", !THREATS.some((word) => lower.includes(word)));

  const scoreRe = ctx.score ? new RegExp(`(?<![\\d.])${ctx.score.replace(".", "\\.")}(?![\\d])`) : null;
  const internal =
    (ctx.failureCode && lower.includes(ctx.failureCode.toLowerCase())) ||
    (ctx.failureMessage.length >= 6 && lower.includes(ctx.failureMessage.toLowerCase())) ||
    (scoreRe !== null && scoreRe.test(all));
  add("no_internal_data", !internal);

  add(
    "non_disclosure",
    !NON_DISCLOSABLE.has(ctx.failureCode.toLowerCase()) || !/lost|stolen|fraud|blacklist|block list|pickup|restricted/i.test(all),
  );

  const allowed = new Set([ctx.hostedInvoiceUrl, ctx.support].filter(Boolean).map((v) => v.toLowerCase()));
  const urls = (all.match(URL_RE) ?? []).map((u) => trimUrl(u).toLowerCase());
  const emails = (all.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase());
  // An email that is a substring of an allowed URL is part of that URL; ignore it.
  const strayEmail = emails.some((e) => !allowed.has(e) && ![...allowed].some((a) => a.includes(e) && a.startsWith("http")));
  const strayUrl = urls.some((u) => !allowed.has(u));
  add("no_stray_contacts", !strayEmail && !strayUrl);
  add("no_placeholders", !all.includes("{{") && !all.includes("}}"));
  return results;
}

export function checksPass(results: CheckResult[]): boolean {
  return results.every((c) => c.ok);
}

export function issueLine(failureCode: string): string {
  switch (failureCode.toLowerCase()) {
    case "expired_card":
      return "The card we have on file has expired.";
    case "authentication_required":
      return "Your bank needs you to confirm this payment.";
    case "insufficient_funds":
    case "processing_error":
      return "The payment did not go through.";
    default:
      // Includes the whole non-disclosable set: lost/stolen/fraudulent/blocked must look like a generic decline.
      return "We were unable to process the payment.";
  }
}

const TEMPLATES: Record<Tone, { subject: string; body: string }> = {
  concise: {
    subject: "A quick note about your {{business}} payment",
    body: `Hi,

{{issue_line}} Invoice {{invoice_id}} for {{amount}} is still unpaid.
{{link_line}}
If you need help, contact {{support}}.

Thanks,
{{business}}`,
  },
  friendly: {
    subject: "Quick heads-up on your {{business}} payment",
    body: `Hi there,

Just a friendly heads-up: {{issue_line}} Invoice {{invoice_id}} ({{amount}}) is still open.
{{link_line}}
No worries if this is already sorted. If anything looks off or you would like a hand, reach us at {{support}}.

Thanks so much,
The {{business}} team`,
  },
  professional: {
    subject: "Payment issue on invoice {{invoice_id}}",
    body: `Hello,

We were unable to complete the recent payment for invoice {{invoice_id}} ({{amount}}). {{issue_line}}
{{link_line}}
If you have questions about this invoice, please contact {{support}}.

Kind regards,
{{business}}`,
  },
};

export interface TemplateValues {
  business: string;
  invoiceId: string;
  amount: string;
  issue: string;
  hostedInvoiceUrl: string;
  support: string;
}

export function renderTemplate(tone: Tone, v: TemplateValues): { subject: string; body: string } {
  const linkLine = v.hostedInvoiceUrl
    ? `You can review and pay the invoice securely here: ${v.hostedInvoiceUrl}`
    : "To update your payment details, please get in touch with us.";
  // Single-pass replacement so values containing "{{" can never be re-expanded.
  const fill = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
      const map: Record<string, string> = {
        business: v.business,
        invoice_id: v.invoiceId,
        amount: v.amount,
        issue_line: v.issue,
        link_line: linkLine,
        support: v.support,
      };
      return map[key] ?? "";
    });
  const t = TEMPLATES[tone];
  return { subject: fill(t.subject), body: fill(t.body) };
}
