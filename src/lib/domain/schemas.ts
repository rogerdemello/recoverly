/**
 * Shared contracts (client + server safe: no Node imports). See docs/technical-spec.md sections 4 and 5.2.
 */
import { z } from "zod";

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const STATES = ["failed", "in_recovery", "action_needed", "recovered", "not_recovered", "unknown"] as const;
export const ACTIONS = [
  "update_payment_method",
  "wait_for_retry",
  "review_manually",
  "contact_customer",
  "do_not_pursue",
] as const;

export const priorityEnum = z.enum(PRIORITIES);
export const stateEnum = z.enum(STATES);
export const actionEnum = z.enum(ACTIONS);

export type Priority = (typeof PRIORITIES)[number];
export type State = (typeof STATES)[number];
export type Action = (typeof ACTIONS)[number];

export const analysisPlanSchema = z
  .object({
    intent: z.enum(["rank_recoverable", "failure_reasons", "in_recovery", "unsupported"]),
    filters: z
      .object({
        failed_within_days: z.number().int().min(1).max(365).optional(),
        min_amount_minor: z.number().int().min(0).optional(),
        currency: z
          .string()
          .regex(/^[a-z]{3}$/)
          .optional(),
        states: z.array(stateEnum).max(6).optional(),
        failure_codes: z
          .array(z.string().regex(/^[a-z0-9_]{1,64}$/))
          .max(20)
          .optional(),
        priority_at_least: priorityEnum.optional(),
      })
      .strict()
      .default({}),
    group_by: z.array(z.enum(["failure_code", "state"])).max(2).default([]),
    top_n: z.number().int().min(1).max(50).default(10),
    then_draft: z.boolean().default(false),
    explanation: z.string().min(1).max(400),
    fields_used: z.array(z.string().min(1).max(64)).max(20).default([]),
    unsupported_reason: z.string().max(400).optional(),
  })
  .strict()
  .refine((p) => p.intent !== "unsupported" || Boolean(p.unsupported_reason), {
    message: "unsupported_reason is required when intent is unsupported",
    path: ["unsupported_reason"],
  });

export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;

const minor = z.number().int().nonnegative();

export const evidenceSchema = z.object({
  field: z.string(),
  value: z.union([z.string(), z.number(), z.null()]),
  source: z.enum(["stripe_fact", "agent_inference"]),
});

export const queueItemSchema = z
  .object({
    rank: z.number().int().min(1),
    invoice_id: z.string().min(1),
    customer_id: z.string().min(1),
    customer_email_masked: z.string(),
    subscription_id: z.string().nullable(),
    currency: z.string().regex(/^[a-z]{3}$/),
    amount_minor: minor,
    state: stateEnum,
    priority: priorityEnum,
    score: z.number().min(0).max(100),
    components: z.object({
      amount_norm: z.number().min(0).max(1),
      recovery: z.number().min(0).max(1),
      urgency: z.number().min(0).max(1),
      value: z.number().min(0).max(1),
    }),
    recommended_action: actionEnum,
    reason: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    missing_inputs: z.array(z.string()),
    failure_code: z.string(),
    attempt_count: z.number().int().nonnegative(),
    days_since_failure: z.number().nonnegative(),
    retry: z.object({
      status: z.enum(["scheduled", "none_scheduled", "unknown"]),
      next_attempt_at: z.string().nullable(),
    }),
    hosted_invoice_url_present: z.boolean(),
    evidence: z.array(evidenceSchema),
  })
  .strict();

export const analysisResultSchema = z
  .object({
    schema_version: z.literal("1"),
    as_of: z.string(),
    plan: analysisPlanSchema,
    summary: z.string(),
    metrics: z
      .object({
        records_total: minor,
        records_in_scope: minor,
        by_currency: z.array(
          z.object({
            currency: z.string(),
            failed_count: minor,
            affected_customers: minor,
            amount_at_risk_minor: minor,
            in_recovery_minor: minor,
            action_needed_minor: minor,
            failed_minor: minor,
          }),
        ),
        by_failure_code: z.array(
          z.object({ currency: z.string(), failure_code: z.string(), count: minor, amount_minor: minor }),
        ),
        by_state: z.array(z.object({ currency: z.string(), state: stateEnum, count: minor, amount_minor: minor })),
      })
      .strict(),
    queues: z.array(z.object({ currency: z.string(), items: z.array(queueItemSchema) }).strict()),
    resolved: z.array(
      z
        .object({
          invoice_id: z.string(),
          customer_id: z.string(),
          currency: z.string(),
          amount_minor: minor,
          state: z.enum(["recovered", "not_recovered"]),
          recommended_action: z.literal("do_not_pursue"),
          reason: z.string(),
        })
        .strict(),
    ),
    warnings: z.array(z.string()),
    data_quality: z
      .object({
        records_with_missing_inputs: minor,
        unrecognized_failure_codes: z.array(z.string()),
        currencies: z.array(z.string()),
        single_item_currencies: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type QueueItem = z.infer<typeof queueItemSchema>;

/** The canonical demo plan (Golden B). Also the plan embedded in sandbox/replay/rank_recoverable.py. */
export const DEMO_QUESTION =
  "Find the failed payments from the last seven days with the highest recoverable revenue. Explain the reason and recommend the next safe action.";

export const DEMO_PLAN: AnalysisPlan = {
  intent: "rank_recoverable",
  filters: { failed_within_days: 7 },
  group_by: [],
  top_n: 10,
  then_draft: false,
  explanation:
    "Rank unresolved failed payments from the last 7 days by recovery priority, using failure code, retry status, amount, age and customer tenure.",
  fields_used: [
    "failed_at",
    "amount_due",
    "currency",
    "failure_code",
    "next_payment_attempt",
    "attempt_count",
    "invoice_status",
    "customer_created_at",
  ],
};

export const EXAMPLE_QUESTIONS = [
  DEMO_QUESTION,
  "What are the top failure reasons?",
  "Which customers are still in recovery?",
  "Draft a message for the three highest-priority customers.",
];

/** Error codes from technical-spec section 8. */
export type ErrorCode =
  | "CSV_INVALID"
  | "DATASET_NOT_FOUND"
  | "ANALYSIS_NOT_FOUND"
  | "DRAFT_NOT_FOUND"
  | "BAD_REQUEST"
  | "UNSUPPORTED_REQUEST"
  | "LLM_UNAVAILABLE"
  | "GENERATION_FAILED"
  | "SANDBOX_UNAVAILABLE"
  | "SANDBOX_RATE_LIMITED"
  | "SANDBOX_OUT_OF_CREDIT"
  | "SANDBOX_TIMEOUT"
  | "SANDBOX_EXEC_FAILED"
  | "RESULT_INVALID"
  | "DRAFT_NOT_ELIGIBLE"
  | "APPROVAL_INVALID"
  | "SEND_FAILED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown[] };
}

export interface DatasetSummary {
  datasetId: string;
  source: "fixture" | "upload";
  synthetic: boolean;
  asOf: string;
  rows: number;
  currencies: string[];
  warnings: string[];
}

export interface DraftView {
  draftId: string;
  invoiceId: string;
  customerId: string;
  toMasked: string;
  subject: string;
  body: string;
  tone: Tone;
  source: "llm" | "template";
  fieldsUsed: string[];
  checks: Array<{ name: string; ok: boolean }>;
  approval: { nonce: string; expiresAt: string };
  delivery: { mode: "disabled" | "enabled"; note: string };
}

export type Tone = "concise" | "friendly" | "professional";
export const TONES: Tone[] = ["concise", "friendly", "professional"];

export interface AuditEntry {
  auditId: string;
  ts: string;
  action: "draft_generated" | "draft_approved" | "approval_rejected" | "send_failed";
  invoiceId: string;
  customerId: string;
  toMasked: string;
  tone: string;
  source: "llm" | "template";
  messageSha256: string;
  messageLength: number;
  deliveryStatus: "not_attempted" | "sent" | "failed";
  actor: "operator";
}

export const DRAFT_ELIGIBLE_ACTIONS: Action[] = ["update_payment_method", "contact_customer", "review_manually"];
