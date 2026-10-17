import { z } from "zod";

export const analysisFiltersSchema = z
  .object({
    min_amount_minor: z.number().int().nonnegative().optional(),
    max_amount_minor: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    failed_within_days: z.number().positive().max(365).optional(),
    failure_codes: z.array(z.string()).max(20).optional(),
    invoice_status: z.array(z.string()).max(10).optional(),
    recovery_state: z.array(z.string()).max(10).optional(),
  })
  .strict();

export const analysisPlanSchema = z
  .object({
    question: z.string().min(1),
    intent: z.enum(["rank_recoverable", "breakdown", "customer_investigate", "compare", "other"]),
    filters: analysisFiltersSchema.default({}),
    metrics: z
      .array(
        z.enum([
          "total_amount_at_risk",
          "failed_count",
          "customer_count",
          "by_failure_code",
          "by_recovery_status",
          "recovery_rate",
        ]),
      )
      .min(1),
    rank_by: z.enum(["priority_score", "amount_due", "confidence"]).default("priority_score"),
    top_n: z.number().int().min(1).max(50).default(10),
    rationale: z.string().min(1),
  })
  .strict();

export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;

export const scoreComponentsSchema = z.object({
  amount: z.number(),
  recovery: z.number(),
  urgency: z.number(),
  customer_value: z.number(),
});

export const rankedItemSchema = z
  .object({
    rank: z.number().int().min(1),
    customer_id: z.string(),
    invoice_id: z.string(),
    amount_due: z.number(),
    currency: z.string(),
    failure_code: z.string(),
    invoice_status: z.string(),
    recovery_state: z.string().optional(),
    attempt_count: z.number().optional(),
    priority: z.enum(["urgent", "high", "medium", "low"]),
    priority_score: z.number(),
    confidence: z.number(),
    score_components: scoreComponentsSchema,
    recommended_action: z.enum([
      "update_payment_method",
      "wait_for_retry",
      "review_manually",
      "contact_customer",
      "do_not_pursue",
    ]),
    rank_reason: z.string().optional(),
    missing_fields: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
    source_tags: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

export type RankedItem = z.infer<typeof rankedItemSchema>;

export const analysisResultSchema = z
  .object({
    summary: z.string().min(1),
    metrics: z
      .object({
        total_failed_count: z.number().int().nonnegative(),
        total_customer_count: z.number().int().nonnegative(),
        by_currency: z.record(
          z.string(),
          z.object({
            amount_at_risk_minor: z.number(),
            failed_count: z.number().int().nonnegative(),
            customer_count: z.number().int().nonnegative(),
          }),
        ),
        by_failure_code: z.record(
          z.string(),
          z.object({
            count: z.number().int().nonnegative(),
            amount_by_currency: z.record(z.string(), z.number()),
          }),
        ),
        by_recovery_status: z.record(
          z.string(),
          z.object({
            count: z.number().int().nonnegative(),
            amount_by_currency: z.record(z.string(), z.number()),
          }),
        ),
      })
      .strict(),
    ranked_items: z.array(rankedItemSchema),
    warnings: z.array(z.string()).default([]),
    data_quality: z
      .object({
        required_fields: z.array(z.string()).default([]),
        partial_rows: z.number().int().nonnegative().default(0),
        missing_field_counts: z.record(z.string(), z.number()).default({}),
        notes: z.array(z.string()).default([]),
      })
      .strict()
      .default({ required_fields: [], partial_rows: 0, missing_field_counts: {}, notes: [] }),
  })
  .strict();

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
