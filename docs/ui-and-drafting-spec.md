# Recoverly: UI and Message Drafting Specification

Companion to [technical-spec.md](technical-spec.md). Data shapes (`AnalysisResult`, `QueueItem`, error codes, API routes) are defined there; expected values are in [fixture-spec.md](fixture-spec.md). This document fixes the behavior a user sees and the rules for customer-facing text.

## 1. Principles

1. **Explain, don't score.** Every ranked row can answer: which fields drove this, what failure was observed, is a retry scheduled, and is each fact a *Stripe fact* or an *agent inference*.
2. **Show both numbers.** Amount at risk and recovery priority are separate columns. The highest amount is not necessarily the most recoverable (row 009 vs 007 in the fixture is the demo example).
3. **Failure is never success-shaped.** Every error code in technical-spec §8 has a visible, specific message; no blank results, no silent fallbacks.
4. **No side effects.** The UI has no control that charges, retries, cancels, or sends. Drafting ends at an approval that, in the MVP, records the decision only.
5. **Honest labels.** Synthetic data is badged. The score is labelled a heuristic. No claim of a measured recovery-rate improvement anywhere.
6. **Never sum across currencies.** Each currency has its own tiles and its own queue.

No component library is required; plain CSS with light/dark support via `prefers-color-scheme`. Layout must work at 1280 px wide (the recording size) and degrade acceptably down to 375 px. Everything interactive is keyboard reachable; priority and confidence are conveyed by text as well as color.

## 2. Page layout (single route `/`)

Regions top to bottom. State lives in the client; data comes from the API in technical-spec §7.

### 2.1 Header and data source

- Product name and one-line tagline: "Explainable failed-payment recovery. Analysis code is written by an agent and run in an isolated sandbox."
- Integration chips from `GET /api/health`: **Sandbox** (configured / not), **LLM** (configured / not), **Message delivery** (shown as "Draft-only" unless enabled).
- Buttons: **Load demo data** (`source: "fixture"`) and **Upload CSV**. After loading, a dataset chip shows rows, currencies, `as_of`, and a **"Synthetic demo data"** badge when `synthetic = true`.
- `CSV_INVALID` renders a table of `row | column | problem` (max 20 rows) instead of the dataset chip.

### 2.2 Ask panel

- Textarea (max 500 chars, live counter), **Run analysis** button, disabled until a dataset is loaded.
- Example chips (click fills the textarea; they do not auto-run):
  1. `Find the failed payments from the last seven days with the highest recoverable revenue. Explain the reason and recommend the next safe action.` (the demo question)
  2. `What are the top failure reasons?`
  3. `Which customers are still in recovery?`
  4. `Draft a message for the three highest-priority customers.` (planner sets `then_draft: true`)
- A **"Replay saved script"** checkbox, labelled "Skips code generation; runs a previously saved script in the sandbox". Off by default.

### 2.3 Pipeline stepper

Five steps in a row: **Plan, Code, Guard, Sandbox, Validate**. Each shows `pending / running / ok / failed` and elapsed time; a second attempt shows "attempt 2". The stepper is driven by the SSE events. After success show total elapsed: "Recovery queue ready in 8.4 s" (spec metric: time from import to first queue).

### 2.4 Plan card

Appears on the `plan` event, **before any code runs**: the `explanation`, filter chips (e.g. `failed within 7 days`), `top_n`, and `fields_used`. `unsupported` plans render an info panel with `unsupported_reason` and the example chips.

### 2.5 Code and run log

- **Generated code** panel: monospaced, scrollable, collapsible, with a badge `Generated` or `Replay (saved script)` and attempt tabs if a retry occurred. No syntax highlighter is required.
- **Run log** panel: guard result (violations listed), sandbox status, exit code, `execMs`, short sandbox id, and `stderrTail` when present. Failed attempts remain visible after a successful retry.

### 2.6 Results

1. **Warnings strip** (technical-spec §4.2) with friendly copy, e.g. `single_item_currency:eur` becomes "Only one EUR invoice: its score is normalized against itself and is not comparable to USD scores."
2. **Metric tiles, one group per currency:** amount at risk, affected customers, in recovery (scheduled retry), queued invoices. Amounts via `formatMoney` (minor units to major using the currency's exponent; zero-decimal set `bif clp djf gnf jpy kmf krw mga pyg rwf ugx vnd vuv xaf xof xpf`).
3. **Breakdown tables:** failure reasons (`by_failure_code`) and recovery status (`by_state`), per currency.
4. **Queue, one table per currency.** Columns: Rank, Customer (masked email), Amount, Priority badge, State, Recommended action, Confidence, Score. Rows are clickable and keyboard activatable. The score header has a tooltip: "Heuristic triage score from 0 to 100. Not a prediction of recovery."
5. **Resolved** (collapsed by default): paid, void and uncollectible invoices that were removed from the action queue, each with its reason.

### 2.7 Detail drawer (Journey B)

Opens from a queue row. Contents:

- Header: invoice id, masked customer email, amount.
- **Why this rank:** four horizontal bars showing weighted points `45*amount_norm`, `25*recovery`, `20*urgency`, `10*value` (they sum to the score within display rounding), then the `reason` text.
- **What we know vs infer:** the `evidence` list. Each row shows field, value, and a badge **"Stripe fact"** or **"Agent inference"**.
- **What is uncertain:** confidence level, and each `missing_inputs` entry with a one-line explanation (e.g. "`next_payment_attempt` is unknown, so we cannot tell whether a retry is scheduled").
- **Retry status:** scheduled (with date), none scheduled, or unknown.
- **Recommended next step:** the action name, its rationale, and a **Draft message** button, enabled only for `update_payment_method`, `contact_customer` and `review_manually`. For `wait_for_retry` and `do_not_pursue`, show "No message needed" with the reason.

### 2.8 Audit drawer

A header button opens the list from `GET /api/audit`: time, action, invoice, masked recipient, tone, delivery status, message hash prefix.

## 3. Message drafting

### 3.1 Eligibility and allowed inputs

A draft may be created only when `recommended_action` is `update_payment_method`, `contact_customer` or `review_manually` and the invoice is not resolved; otherwise `409 DRAFT_NOT_ELIGIBLE`.

The drafter may use **only** these fields:

| Field | Source |
| --- | --- |
| Formatted amount and currency | the item's `amount_minor`, `currency` |
| Invoice id | `invoice_id` |
| Hosted invoice URL | the record's `hosted_invoice_url`, server-side (the sandbox result only carries `hosted_invoice_url_present`) |
| Business name, support contact | `BUSINESS_NAME`, `SUPPORT_CONTACT` env values |
| Issue wording | derived from `failure_code` using the table below, never the code itself |

It may **not** use: raw `failure_code` or `failure_message`, tenure, score or priority, attempt counts, other customers' data, or any email other than the `to` address.

Issue wording (`issue_line`):

| `failure_code` | `issue_line` |
| --- | --- |
| `expired_card` | `The card we have on file has expired.` |
| `authentication_required` | `Your bank needs you to confirm this payment.` |
| `insufficient_funds`, `processing_error` | `The payment did not go through.` |
| anything else, **including the whole non-disclosable set** | `We were unable to process the payment.` |

This follows Stripe's guidance that lost, stolen, fraudulent and blocked-list declines must be shown to the customer as a generic decline.

### 3.2 Flow

1. `POST /api/draft { analysisId, invoiceId, tone }`. The server re-reads the item from the stored analysis (it never trusts client-supplied amounts), loads the raw email and URL from the dataset, and checks that the invoice is still unpaid in the dataset.
2. Generate the body with the LLM using the prompt in [agent-prompts.md](agent-prompts.md) (inputs: the allowed fields only). Run the content checks (§4). If any fail, regenerate once with the failed check names; if still failing, use the **deterministic template** for the tone (§4.2) with `source: "template"`. A draft is therefore always produced, and always passes the checks.
3. Respond with `DraftView`:

```ts
interface DraftView {
  draftId: string;
  invoiceId: string;
  customerId: string;
  toMasked: string;                       // never the raw address
  subject: string;
  body: string;
  tone: "concise" | "friendly" | "professional";
  source: "llm" | "template";
  fieldsUsed: string[];                   // e.g. ["amount","currency","invoice_id","hosted_invoice_url","business_name","support_contact","issue_line"]
  checks: Array<{ name: string; ok: boolean }>;
  approval: { nonce: string; expiresAt: string };   // single use, 30 minutes
  delivery: { mode: "disabled" | "enabled"; note: string };
}
```

4. The draft modal shows: **target** (masked recipient + invoice), the **exact subject and body**, the checks list, and the delivery note. The primary button reads **"Approve draft"** when delivery is enabled and **"Approve (will not be sent: delivery is disabled)"** when disabled. The body may be edited; edits are re-checked on approve.
5. `POST /api/draft/:draftId/approve { nonce, confirm: true, editedBody? }`:
   - Invalid, reused or expired nonce, `confirm` not exactly `true`, or failed checks on an edited body: `403 APPROVAL_INVALID`; nothing is recorded as approved.
   - Delivery disabled (the MVP): status `approved_not_sent`. The modal then shows the final message with a **Copy** button and the text "Approved. Delivery is disabled, so nothing was sent."
   - Delivery enabled and the adapter fails: `send_failed`; the approved draft is **preserved** server-side so the operator can retry. (No delivery adapter is built in the MVP; the interface exists so this path is testable with a stub.)
6. Every approve attempt writes an audit entry.

### 3.3 Audit entries

Append-only, in memory and to `.recoverly/audit.jsonl` (git-ignored). Entries hold **no message body and no raw email**:

```ts
interface AuditEntry {
  auditId: string;
  ts: string;                             // ISO-8601 UTC
  action: "draft_generated" | "draft_approved" | "approval_rejected" | "send_failed";
  invoiceId: string;
  customerId: string;
  toMasked: string;
  tone: string;
  source: "llm" | "template";
  messageSha256: string;                  // of the final subject + "\n" + body
  messageLength: number;
  deliveryStatus: "not_attempted" | "sent" | "failed";
  actor: "operator";
}
```

## 4. Content checks and templates

### 4.1 Checks (run on LLM output and on edited bodies; each has a stable `name`)

| `name` | Rule |
| --- | --- |
| `length` | subject at most 80 chars, body at most 1200 |
| `amount_present` | body contains the formatted amount (e.g. `$499.00`) |
| `link_or_support` | contains the exact `hosted_invoice_url` when one exists; otherwise contains no URL |
| `support_present` | contains `SUPPORT_CONTACT` |
| `no_card_numbers` | no run of 13 to 19 digits (spaces/dashes allowed between groups) |
| `no_threats` | none of (case-insensitive): `suspend`, `terminat`, `legal`, `lawsuit`, `collections`, `final notice`, `penalt`, `immediately`, `urgent action`, `guarantee`, `will succeed`, `will be charged` |
| `no_internal_data` | does not contain the raw `failure_code`, the `failure_message`, or the score |
| `non_disclosure` | when the code is in the non-disclosable set: no match for `lost`, `stolen`, `fraud`, `blacklist`, `block list`, `pickup`, `restricted` |
| `no_stray_contacts` | no email address or URL other than `hosted_invoice_url` and the support contact |
| `no_placeholders` | no `{{` or `}}` left over |

### 4.2 Deterministic templates (the guaranteed fallback)

Placeholders: `{{business}}`, `{{invoice_id}}`, `{{amount}}`, `{{issue_line}}`, `{{link_line}}`, `{{support}}`.
`{{link_line}}` is `You can review and pay the invoice securely here: <hosted_invoice_url>` when a URL exists, otherwise `To update your payment details, please get in touch with us.`

**concise**

```text
Subject: A quick note about your {{business}} payment

Hi,

{{issue_line}} Invoice {{invoice_id}} for {{amount}} is still unpaid.
{{link_line}}
If you need help, contact {{support}}.

Thanks,
{{business}}
```

**friendly**

```text
Subject: Quick heads-up on your {{business}} payment

Hi there,

Just a friendly heads-up: {{issue_line}} Invoice {{invoice_id}} ({{amount}}) is still open.
{{link_line}}
No worries if this is already sorted. If anything looks off or you would like a hand, reach us at {{support}}.

Thanks so much,
The {{business}} team
```

**professional**

```text
Subject: Payment issue on invoice {{invoice_id}}

Hello,

We were unable to complete the recent payment for invoice {{invoice_id}} ({{amount}}). {{issue_line}}
{{link_line}}
If you have questions about this invoice, please contact {{support}}.

Kind regards,
{{business}}
```

All three templates must pass every check in §4.1 for every fixture row that is draft-eligible (a unit test).

## 5. Copy rules for the UI and public materials

- Always say "heuristic", "estimate", "recommended". Never "predicts", "guarantees", "will recover".
- Label the dataset as synthetic in the UI, the README, the demo and the posts.
- Present Recoverly as an operator layer: "Recoverly does not replace Stripe Smart Retries or Stripe's customer emails. It helps decide what to do next."
- Do not show real-looking card details anywhere. Do not display raw `failure_message` text next to a customer-facing draft.
