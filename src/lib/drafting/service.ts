/**
 * Draft creation, approval and audit (ui-and-drafting-spec 3). Nothing here sends a message in the MVP:
 * approval records the decision; a delivery adapter can be plugged in for the enabled path.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { extractJsonObject, getLlm, LlmUnavailableError } from "../agent/llm";
import { formatMoney } from "../domain/money";
import {
  DRAFT_ELIGIBLE_ACTIONS,
  type AuditEntry,
  type DraftView,
  type QueueItem,
  type Tone,
} from "../domain/schemas";
import { ApiError } from "../errors";
import { auditLog, getAnalysis, getDataset, getDraft, saveDraft, type StoredDraft } from "../store";
import { checksPass, issueLine, renderTemplate, runChecks, type CheckContext } from "./checks";

const NONCE_TTL_MS = 30 * 60 * 1000;

export interface DeliveryAdapter {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

let adapter: DeliveryAdapter | null = null;
/** The MVP ships no adapter; tests and future integrations can plug one in. */
export function setDeliveryAdapter(next: DeliveryAdapter | null): void {
  adapter = next;
}

export function sendEnabled(): boolean {
  return process.env.RECOVERLY_ENABLE_SEND === "true";
}

function business(): string {
  return process.env.BUSINESS_NAME?.trim() || "Acme Cloud (demo)";
}
function support(): string {
  return process.env.SUPPORT_CONTACT?.trim() || "support@example.test";
}

function writeAudit(entry: Omit<AuditEntry, "auditId" | "ts" | "actor">): AuditEntry {
  const full: AuditEntry = { auditId: `au_${randomUUID().slice(0, 12)}`, ts: new Date().toISOString(), actor: "operator", ...entry };
  auditLog().push(full);
  try {
    const dir = path.join(process.cwd(), ".recoverly");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "audit.jsonl"), `${JSON.stringify(full)}\n`);
  } catch {
    // Read-only filesystem (some hosts): the in-memory log still holds the entry.
  }
  return full;
}

export function listAudit(): AuditEntry[] {
  return [...auditLog()].reverse().slice(0, 200);
}

function sha256(subject: string, body: string): string {
  return createHash("sha256").update(`${subject}\n${body}`).digest("hex");
}

const draftReplySchema = z.object({ subject: z.string().min(1).max(200), body: z.string().min(1).max(4000) });

const DRAFT_SYSTEM = (tone: Tone, issue: string, invoiceId: string, amount: string, support: string, biz: string) => `You write a short, polite email to a subscription customer whose recurring payment did not go through.
Return ONE JSON object: {"subject": string, "body": string}. No other text.

Rules:
- Tone: ${tone} (concise = 3 to 4 short lines; friendly = warm and casual; professional = formal and neutral).
- Include the issue sentence EXACTLY as given: "${issue}". Do not add or guess any other reason for the failure.
- Include the invoice id ${invoiceId} and the amount ${amount} exactly as given.
- If a payment link is given, include it exactly once, unchanged, with a sentence saying it is a secure page to review and pay the invoice. If it is "none", do not include any link; ask the customer to get in touch to update their payment details.
- Include the support contact ${support} and sign off as ${biz}.
- Never threaten, create false urgency, mention suspension, cancellation, legal action or collections, or promise that a charge will succeed.
- Never mention card numbers, security codes, fraud, lost or stolen cards, or internal scores.
- Plain text, under 900 characters. The customer is a person who may be busy: be brief.`;

interface Generated {
  subject: string;
  body: string;
  source: "llm" | "template";
}

async function generateMessage(
  tone: Tone,
  invoiceId: string,
  ctx: CheckContext,
  issue: string,
): Promise<Generated> {
  const values = {
    business: business(),
    invoiceId,
    amount: ctx.amount,
    issue,
    hostedInvoiceUrl: ctx.hostedInvoiceUrl,
    support: support(),
  };
  const system = DRAFT_SYSTEM(tone, issue, invoiceId, ctx.amount, support(), business());
  // Allowed inputs only: no email, name, failure code/message, score or tenure.
  const user = `tone: ${tone}\nissue_line: ${issue}\namount: ${ctx.amount}\ninvoice_id: ${invoiceId}\nhosted_invoice_url: ${ctx.hostedInvoiceUrl || "none"}\nbusiness: ${business()}\nsupport: ${support()}`;

  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await getLlm().json(system, attempt === 0 ? user : `${user}\n\nYour previous draft failed these checks: ${feedback}. Fix them.`, { maxTokens: 700, timeoutMs: 45_000 });
      const parsed = draftReplySchema.parse(extractJsonObject(reply));
      const results = runChecks(parsed.subject.trim(), parsed.body.trim(), ctx);
      if (checksPass(results)) return { subject: parsed.subject.trim(), body: parsed.body.trim(), source: "llm" };
      feedback = results.filter((c) => !c.ok).map((c) => c.name).join(", ");
    } catch (err) {
      if (err instanceof LlmUnavailableError) break; // template is the guaranteed fallback
      feedback = "unparseable reply";
    }
  }
  return { ...renderTemplate(tone, values), source: "template" };
}

function findItem(analysisId: string, invoiceId: string) {
  const analysis = getAnalysis(analysisId);
  if (!analysis) throw new ApiError("ANALYSIS_NOT_FOUND", "That analysis is no longer available. Run the analysis again.");
  let item: QueueItem | undefined;
  for (const q of analysis.result.queues) item ??= q.items.find((i) => i.invoice_id === invoiceId);
  if (!item) {
    if (analysis.result.resolved.some((r) => r.invoice_id === invoiceId)) {
      throw new ApiError("DRAFT_NOT_ELIGIBLE", "This invoice is already resolved, so no message is needed.");
    }
    throw new ApiError("BAD_REQUEST", "That invoice is not part of this analysis.");
  }
  return { analysis, item };
}

export async function createDraft(analysisId: string, invoiceId: string, tone: Tone): Promise<DraftView> {
  const { analysis, item } = findItem(analysisId, invoiceId);
  if (!DRAFT_ELIGIBLE_ACTIONS.includes(item.recommended_action)) {
    throw new ApiError(
      "DRAFT_NOT_ELIGIBLE",
      item.recommended_action === "wait_for_retry"
        ? "A retry is already scheduled, so no message is needed yet."
        : "No message is needed for this invoice.",
    );
  }
  const dataset = getDataset(analysis.datasetId);
  if (!dataset) throw new ApiError("DATASET_NOT_FOUND", "The dataset is no longer available. Reload the data.");
  const raw = dataset.records.find((r) => r.invoice_id === invoiceId);
  if (!raw) throw new ApiError("BAD_REQUEST", "That invoice is not part of the dataset.");
  if (raw.invoice_status !== "open") throw new ApiError("DRAFT_NOT_ELIGIBLE", `The invoice is ${raw.invoice_status}, so no message is needed.`);
  if (!raw.customer_email) throw new ApiError("DRAFT_NOT_ELIGIBLE", "There is no email address on file for this customer.");

  // Amount comes from the stored, validated analysis, never from the client.
  const ctx: CheckContext = {
    amount: formatMoney(item.amount_minor, item.currency),
    hostedInvoiceUrl: raw.hosted_invoice_url,
    support: support(),
    failureCode: raw.failure_code,
    failureMessage: raw.failure_message,
    score: item.score.toFixed(1),
  };
  const message = await generateMessage(tone, invoiceId, ctx, issueLine(raw.failure_code));
  const checks = runChecks(message.subject, message.body, ctx);

  const nonce = randomBytes(24).toString("hex");
  const stored: StoredDraft = {
    draftId: `dr_${randomUUID().slice(0, 12)}`,
    analysisId,
    invoiceId,
    customerId: item.customer_id,
    toRaw: raw.customer_email,
    toMasked: item.customer_email_masked,
    subject: message.subject,
    body: message.body,
    tone,
    source: message.source,
    nonce,
    expiresAt: Date.now() + NONCE_TTL_MS,
    used: false,
    context: ctx,
  };
  saveDraft(stored);
  writeAudit({
    action: "draft_generated",
    invoiceId,
    customerId: stored.customerId,
    toMasked: stored.toMasked,
    tone,
    source: stored.source,
    messageSha256: sha256(stored.subject, stored.body),
    messageLength: stored.subject.length + stored.body.length,
    deliveryStatus: "not_attempted",
  });

  const enabled = sendEnabled();
  return {
    draftId: stored.draftId,
    invoiceId,
    customerId: stored.customerId,
    toMasked: stored.toMasked,
    subject: stored.subject,
    body: stored.body,
    tone,
    source: stored.source,
    fieldsUsed: [
      "amount",
      "currency",
      "invoice_id",
      ...(ctx.hostedInvoiceUrl ? ["hosted_invoice_url"] : []),
      "business_name",
      "support_contact",
      "issue_line",
    ],
    checks,
    approval: { nonce, expiresAt: new Date(stored.expiresAt).toISOString() },
    delivery: {
      mode: enabled ? "enabled" : "disabled",
      note: enabled ? "Delivery is enabled: approving sends this message." : "Delivery is disabled: approving records the decision only. Nothing is sent.",
    },
  };
}

export interface ApproveInput {
  nonce: unknown;
  confirm: unknown;
  editedBody?: unknown;
}

export interface ApproveResult {
  status: "approved_not_sent" | "sent" | "send_failed";
  auditId: string;
  message: { subject: string; body: string };
}

function reject(draft: StoredDraft, reason: string): never {
  writeAudit({
    action: "approval_rejected",
    invoiceId: draft.invoiceId,
    customerId: draft.customerId,
    toMasked: draft.toMasked,
    tone: draft.tone,
    source: draft.source,
    messageSha256: sha256(draft.subject, draft.body),
    messageLength: draft.subject.length + draft.body.length,
    deliveryStatus: "not_attempted",
  });
  throw new ApiError("APPROVAL_INVALID", reason);
}

function nonceMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function approveDraft(draftId: string, input: ApproveInput): Promise<ApproveResult> {
  const draft = getDraft(draftId);
  if (!draft) throw new ApiError("DRAFT_NOT_FOUND", "That draft no longer exists. Generate it again.");

  if (input.confirm !== true) reject(draft, "Approval requires an explicit confirmation.");
  if (draft.used) reject(draft, "This draft was already approved.");
  if (Date.now() > draft.expiresAt) reject(draft, "The approval window expired. Generate the draft again.");
  if (!nonceMatches(draft.nonce, input.nonce)) reject(draft, "The approval token is not valid.");

  let body = draft.body;
  if (input.editedBody !== undefined) {
    if (typeof input.editedBody !== "string") reject(draft, "The edited message must be text.");
    const edited = (input.editedBody as string).trim();
    const failed = runChecks(draft.subject, edited, draft.context).filter((c) => !c.ok).map((c) => c.name);
    if (failed.length) reject(draft, `The edited message failed content checks: ${failed.join(", ")}.`);
    body = edited;
  }

  const message = { subject: draft.subject, body };
  const base = {
    invoiceId: draft.invoiceId,
    customerId: draft.customerId,
    toMasked: draft.toMasked,
    tone: draft.tone,
    source: draft.source,
    messageSha256: sha256(message.subject, message.body),
    messageLength: message.subject.length + message.body.length,
  };

  if (!sendEnabled()) {
    draft.used = true;
    draft.approved = { ...message, status: "approved_not_sent" };
    const entry = writeAudit({ ...base, action: "draft_approved", deliveryStatus: "not_attempted" });
    return { status: "approved_not_sent", auditId: entry.auditId, message };
  }

  try {
    if (!adapter) throw new Error("No delivery adapter is configured.");
    await adapter.send({ to: draft.toRaw, ...message });
    draft.used = true;
    draft.approved = { ...message, status: "sent" };
    const entry = writeAudit({ ...base, action: "draft_approved", deliveryStatus: "sent" });
    return { status: "sent", auditId: entry.auditId, message };
  } catch {
    // The approved draft is preserved so the operator can retry.
    draft.body = body;
    const entry = writeAudit({ ...base, action: "send_failed", deliveryStatus: "failed" });
    return { status: "send_failed", auditId: entry.auditId, message };
  }
}
