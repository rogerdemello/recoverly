# Recoverly: Technical Specification (build contract)

This is the document a coding agent builds from. Product intent lives in [failed-payment-recovery-agent.md](failed-payment-recovery-agent.md) (the "product spec"); schedule and decisions in [implementation-plan.md](implementation-plan.md). Where this document is more specific than the product spec, **this document wins for implementation**. Expected numbers are in [fixture-spec.md](fixture-spec.md); prompts are in [agent-prompts.md](agent-prompts.md); UI and message drafting are in [ui-and-drafting-spec.md](ui-and-drafting-spec.md); the ordered task list is [build-tasks.md](build-tasks.md).

Items marked **UNVERIFIED** could not be confirmed before kickoff and must be checked during the build (collected in §11).

## 1. Stack and layout

| Concern | Choice |
| --- | --- |
| App | Next.js (App Router), TypeScript `strict`, Node runtime for all API routes (`export const runtime = "nodejs"`) |
| Validation | `zod` for every external boundary: CSV rows, LLM JSON, sandbox output, API bodies |
| Tests | `vitest` |
| Sandbox SDK | `@nodeops-createos/sandbox` (**ESM-only**, so `package.json` needs `"type": "module"`) |
| LLM | `openai` SDK pointed at an OpenAI-compatible endpoint (default OpenRouter, provisioned through Stripe Projects) |
| Code run in the sandbox | Python 3.12 from the `devbox:1` image, **standard library only** |

Directory layout:

```text
AGENTS.md                         # rules for coding agents (read first)
docs/                             # these documents
data/fixtures/failed_payments.csv # from fixture-spec.md §2
sandbox/recoverly_lib.py          # deterministic scoring library, uploaded to the sandbox as-is
sandbox/replay/<intent>.py        # known-good generated scripts, used only for labeled replay (§5.6)
src/app/                          # pages and API routes
src/lib/domain/                   # CSV parsing, types, money formatting (TypeScript)
src/lib/agent/                    # planner, codegen, guard, pipeline, llm client
src/lib/sandbox/runner.ts         # CreateOS runner (§6)
src/lib/drafting/                 # drafter, checks, templates, approval, audit
tests/                            # vitest; golden tests read docs/fixture-spec.md values
```

Environment variables (names only; values come from `.env`, never printed):

| Variable | Purpose | Notes |
| --- | --- | --- |
| `CREATEOS_SANDBOX_API_KEY` or `CREATEOS_API_KEY` | Sandbox SDK auth | The SDK reads `CREATEOS_SANDBOX_API_KEY`; the CreateOS REST docs use `CREATEOS_API_KEY`. The operator's key is currently stored as `CREATEOS_API_KEY` in `.env`. The runner must therefore read `process.env.CREATEOS_SANDBOX_API_KEY ?? process.env.CREATEOS_API_KEY` and pass it explicitly as `createClient({ apiKey })`. **UNVERIFIED:** that this key authenticates the Sandbox API (first call in the M0 spike: `whoami()`), and which name `stripe projects` writes (`stripe projects env`). |
| `OPENROUTER_API_KEY` | LLM auth | Or the equivalent name written by `stripe projects add`. **UNVERIFIED.** |
| `RECOVERLY_MODEL` | Model slug | **UNVERIFIED**; confirm against the provider's model list. |
| `RECOVERLY_LLM_BASE_URL` | LLM endpoint | Default `https://openrouter.ai/api/v1`. |
| `RECOVERLY_ENABLE_SEND` | Customer message delivery | Anything other than the literal `true` means off. No delivery adapter is built in the MVP. |
| `RECOVERLY_ACCESS_CODE` | Optional shared passcode for the public demo | If set, API routes require header `x-access-code`. Unset by default. |
| `BUSINESS_NAME`, `SUPPORT_CONTACT` | Used in drafted messages | Defaults: `Acme Cloud (demo)`, `support@example.test`. |

`.env.example` lists names only. `.env`, `.env.*`, `.projects/vault/` are git-ignored.

## 2. Data contract

### 2.1 CSV schema

Header row required, exact column names, any column order. Extra columns are ignored (and never uploaded to the sandbox).

| Column | Type | Required | Rules |
| --- | --- | --- | --- |
| `customer_id` | string | yes | Stripe-like id, 1 to 64 chars `[A-Za-z0-9_]` |
| `customer_email` | string | no | Used only server-side for drafts; masked everywhere else (§2.3) |
| `invoice_id` | string | yes | Unique across the file |
| `subscription_id` | string | no | Empty = missing input |
| `amount_due` | integer | yes | Minor currency units, `>= 0` |
| `currency` | string | yes | 3 letters, stored lowercase |
| `failure_code` | string | yes | Stripe decline code or error code, stored lowercase (§3.2 table). Real Stripe data: use `decline_code` if present, else the error `code`. |
| `failure_message` | string | no | Provider-facing text; never shown to customers verbatim |
| `failed_at` | timestamp | yes | ISO-8601 UTC, e.g. `2026-10-15T08:10:00Z` |
| `attempt_count` | integer | yes | `>= 0` |
| `next_payment_attempt` | enum | yes (may be empty) | ISO timestamp = retry scheduled; **empty = no retry scheduled** (Stripe `null`); literal `unknown` = retry info unavailable |
| `invoice_status` | enum | yes | `open`, `paid`, `uncollectible`, `void` (`draft` is rejected) |
| `customer_created_at` | timestamp | no | Empty = missing input |
| `hosted_invoice_url` | string | no | Stripe-hosted invoice page when available; empty = missing input |

### 2.2 Validation rules

- Limits: at most **5000 rows** and **1 MB**.
- Parse as data only. Never `eval`, never build code or shell strings from cell values.
- Reject (whole file, `CSV_INVALID`, `details[]` with `row`, `column`, `problem`) per the table in [fixture-spec.md §7](fixture-spec.md). Collect up to 20 problems, not just the first.
- Cells beginning with `= + - @` are accepted as inert text.
- A PAN-like value (13 to 19 consecutive digits, spaces and dashes allowed between groups) in **any text column** rejects the file; the error must not echo the value.

### 2.3 Masking

`customer_email_masked` = first character of the local part + `***@` + domain (`ava.stone@example.test` becomes `a***@example.test`). Only masked emails go to the sandbox, the UI table, logs and the audit log. The raw email is used only server-side when addressing a draft.

### 2.4 Sandbox input (`data.json`)

```json
{
  "as_of": "2026-10-17T12:00:00Z",
  "records": [
    {
      "customer_id": "cus_synth_001",
      "customer_email_masked": "a***@example.test",
      "invoice_id": "in_synth_001",
      "subscription_id": "sub_synth_001",
      "amount_due": 49900,
      "currency": "usd",
      "failure_code": "expired_card",
      "failure_message": "Your card has expired.",
      "failed_at": "2026-10-15T08:10:00Z",
      "attempt_count": 1,
      "next_payment_attempt": "",
      "invoice_status": "open",
      "customer_created_at": "2024-09-02T00:00:00Z",
      "hosted_invoice_url": "https://example.test/hosted-invoice/in_synth_001"
    }
  ]
}
```

Missing optional values are sent as empty strings. `as_of` is `FIXTURE_AS_OF` in fixture mode and the server clock for uploads.

## 3. Domain rules (the deterministic core)

Implemented once, in `sandbox/recoverly_lib.py`. The TypeScript side does not re-score; it validates the sandbox output (§4). Money is always integers in minor units; never use floats for amounts.

### 3.1 States

Evaluated in order, first match wins. "Required fields" are `invoice_id, customer_id, amount_due, currency, failed_at, failure_code`.

| # | Condition | `state` |
| ---: | --- | --- |
| 1 | `invoice_status = paid` | `recovered` |
| 2 | `invoice_status` is `void` or `uncollectible` | `not_recovered` |
| 3 | any required field missing | `unknown` |
| 4 | `next_payment_attempt = unknown` | `failed` |
| 5 | `next_payment_attempt` is a timestamp strictly after `as_of` | `in_recovery` |
| 6 | otherwise (blank, or a timestamp at or before `as_of`) | `action_needed` |

`recovered` and `not_recovered` records are **resolved**: never queued, always `do_not_pursue`. All others are **queued**. Retry status for evidence: rule 5 = `scheduled`; rule 4 = `unknown`; otherwise `none_scheduled`.

### 3.2 Scoring

```text
days_since_failure = max(0, (as_of - failed_at) in days, as a float)
tenure_days        = (as_of - customer_created_at) in days; missing => value_signal = 0

amount_norm    = amount_due / max_amount[currency]          # max over ALL queued records of the FULL dataset
recovery       = RECOVERY[failure_code]  (default 0.30)
urgency        = min(1, min(days_since_failure / 14, 1) * 0.5
                        + (0.30 if retry status is none_scheduled-by-blank else 0)
                        + (0.20 if attempt_count >= 3 else 0))
value          = min(tenure_days / 365, 1)                  # 0 when customer_created_at is missing

score = 100 * (0.45*amount_norm + 0.25*recovery + 0.20*urgency + 0.10*value)
```

- `max_amount[currency]` is computed over all **queued** records in the **full dataset** (before any plan filter), so scores do not change between questions. If it is 0, `amount_norm = 0`.
- The `+0.30` urgency term applies only when `next_payment_attempt` is **blank** (rule 6 with blank). It does not apply to a past timestamp, `unknown`, or a scheduled retry.
- **Rounding (mandatory, identical in every language):** `round1(x) = floor(x*10 + 0.5) / 10` for `score`; components are rounded to 3 decimals with `floor(x*1000 + 0.5) / 1000`. Do not use Python's `round()` (banker's rounding) or `toFixed`.
- Missing inputs are never invented: a missing `customer_created_at` contributes `value = 0` and is listed in `missing_inputs`.

Recovery signal by `failure_code` (decline-code semantics verified against Stripe's decline-code docs on Oct 17, 2026):

| `failure_code` | `recovery` | Meaning used in `reason` text |
| --- | ---: | --- |
| `expired_card` | 0.90 | card has expired; customer must supply a new card |
| `authentication_required` | 0.80 | payment needs customer authentication |
| `insufficient_funds` | 0.60 | insufficient funds; a retry may succeed |
| `processing_error` | 0.50 | processing error, possibly transient |
| `generic_decline`, `do_not_honor`, `call_issuer`, `card_velocity_exceeded` | 0.35 | card declined, reason unknown |
| `lost_card`, `stolen_card`, `fraudulent`, `merchant_blacklist`, `pickup_card`, `restricted_card` | 0.10 | declined, reason not disclosed (**non-disclosable set**) |
| anything else | 0.30 | unrecognized failure code (adds `failure_code_unrecognized` to `missing_inputs`) |

Stripe's guidance is that the non-disclosable set must be presented to the customer as a generic decline; the drafter and the UI copy follow that (see ui-and-drafting-spec).

### 3.3 Tiers and confidence

Thresholds apply to the **rounded** (1-decimal) score.

| Score | `priority` |
| --- | --- |
| `>= 60` | `urgent` |
| `>= 45` | `high` |
| `>= 30` | `medium` |
| `< 30` | `low` |

`missing_inputs` is the list, in this order, of: `failure_message`, `customer_created_at`, `subscription_id`, `hosted_invoice_url` (when empty), `next_payment_attempt` (only when it is `unknown`), `failure_code_unrecognized`.

| Condition | `confidence` |
| --- | --- |
| `state = unknown` | `low` |
| 0 missing inputs | `high` |
| 1 missing input | `medium` |
| 2 or more | `low` |

### 3.4 Queues and ranking

- **One queue per currency.** Scores are comparable only within a currency. Never sum or rank across currencies.
- Within a queue, sort by `score` desc, then `amount_due` desc, then `invoice_id` asc; `rank` is 1-based after sorting and after plan filters.
- Plan `top_n` truncates each queue **after** ranking; metrics are computed before truncation.
- A currency with exactly one queued item in the full dataset gets the warning `single_item_currency:<cur>`: its `amount_norm` is 1 by construction.

### 3.5 Recommended action

First match wins. Inputs: state, `confidence`, `failure_code`, `attempt_count`, `priority`, `amount_due`.

| # | Condition | `recommended_action` |
| ---: | --- | --- |
| 1 | state is `recovered` or `not_recovered` | `do_not_pursue` |
| 2 | state `unknown`, or `confidence = low` | `review_manually` |
| 3 | `failure_code` in the non-disclosable set | `review_manually` |
| 4 | `failure_code` is `expired_card` or `authentication_required` | `update_payment_method` |
| 5 | state `in_recovery` | `wait_for_retry` |
| 6 | `attempt_count >= 3` or `priority = urgent` | `contact_customer` |
| 7 | `amount_due >= 10000` and `failure_code = generic_decline` | `review_manually` |
| 8 | otherwise | `contact_customer` |

Rule 4 precedes rule 5 on purpose: a scheduled retry will not fix an expired card or a missing authentication.

### 3.6 Reason and evidence

`reason` is **deterministic text built in `recoverly_lib.py`**, never LLM output (the model must not be able to misstate a number). Format: one or two sentences covering (a) the failure meaning from the §3.2 table, (b) the retry status, (c) the largest weighted score contributor. Example: `Card has expired; customer must supply a new card. No retry is scheduled. Ranked highest in usd mainly because of amount at risk.`

`evidence` is an ordered list of `{ "field", "value", "source" }`:

- `source: "stripe_fact"` for values copied from the record: `amount_due`, `currency`, `failure_code`, `failure_message`, `attempt_count`, `next_payment_attempt`, `invoice_status`, `failed_at`, `customer_created_at`.
- `source: "agent_inference"` for everything derived: `days_since_failure`, `retry_status`, `recovery_signal`, `urgency`, `priority`, `recommended_action`, `confidence`.
- Fixture and CSV values are labelled `stripe_fact` because they follow the Stripe object model, and the UI badge for synthetic data says so (ui spec).

## 4. Analysis result contract

### 4.1 Schema (`schema_version: "1"`)

The sandbox script prints exactly one JSON object to stdout. The server validates it with `zod`; anything else is `RESULT_INVALID`.

```ts
type Priority = "urgent" | "high" | "medium" | "low";
type State = "failed" | "in_recovery" | "action_needed" | "recovered" | "not_recovered" | "unknown";
type Action = "update_payment_method" | "wait_for_retry" | "review_manually" | "contact_customer" | "do_not_pursue";

interface AnalysisResult {
  schema_version: "1";
  as_of: string;                         // ISO-8601 UTC
  plan: AnalysisPlan;                    // echo of the executed plan (§5.2)
  summary: string;                       // deterministic text from the numbers below
  metrics: {
    records_total: number;               // rows in the dataset
    records_in_scope: number;            // rows passing plan filters (queued + resolved)
    by_currency: Array<{
      currency: string;
      failed_count: number;              // queued items in scope
      affected_customers: number;        // distinct customer_id among them
      amount_at_risk_minor: number;      // sum of amount_due, queued, in scope
      in_recovery_minor: number;
      action_needed_minor: number;
      failed_minor: number;              // state "failed" + "unknown"
    }>;
    by_failure_code: Array<{ currency: string; failure_code: string; count: number; amount_minor: number }>;
    by_state: Array<{ currency: string; state: State; count: number; amount_minor: number }>;
  };
  queues: Array<{
    currency: string;
    items: Array<{
      rank: number;
      invoice_id: string;
      customer_id: string;
      customer_email_masked: string;
      subscription_id: string | null;
      currency: string;
      amount_minor: number;
      state: State;
      priority: Priority;
      score: number;                     // 1 decimal
      components: { amount_norm: number; recovery: number; urgency: number; value: number };  // 3 decimals
      recommended_action: Action;
      reason: string;
      confidence: "high" | "medium" | "low";
      missing_inputs: string[];
      failure_code: string;
      attempt_count: number;
      days_since_failure: number;        // 3 decimals
      retry: { status: "scheduled" | "none_scheduled" | "unknown"; next_attempt_at: string | null };
      hosted_invoice_url_present: boolean;
      evidence: Array<{ field: string; value: string | number | null; source: "stripe_fact" | "agent_inference" }>;
    }>;
  }>;
  resolved: Array<{ invoice_id: string; customer_id: string; currency: string; amount_minor: number; state: "recovered" | "not_recovered"; recommended_action: "do_not_pursue"; reason: string }>;
  warnings: string[];
  data_quality: {
    records_with_missing_inputs: number;
    unrecognized_failure_codes: string[];
    currencies: string[];
    single_item_currencies: string[];
  };
}
```

Additional validation beyond the shape (all failures are `RESULT_INVALID`, never a success-shaped result):

- every `rank` runs 1..n within its queue; scores sorted non-increasing;
- all `*_minor` values are non-negative integers;
- every `queues[].items[].currency` equals its queue's `currency`;
- `invoice_id`s exist in the input dataset (a generated script cannot invent customers);
- **plan conformance, verified independently by the server from the raw dataset (not from the script's own claims):** every returned item satisfies `plan.filters`; and for the filters expressible on raw fields (`failed_within_days`, `min_amount_minor`, `currency`, `failure_codes`) no raw record that satisfies them is missing from `records_in_scope`. A script that silently dropped or added records fails with `RESULT_INVALID` and the check named in the message;
- the text fields (`reason`, `summary`, `warnings`) contain no email-shaped string except masked ones, and no 13 to 19 digit runs.

### 4.2 Warnings

Machine-readable prefixes, shown verbatim in the UI warning list with friendly copy:

| Warning | When |
| --- | --- |
| `single_item_currency:<cur>` | §3.4 |
| `missing_inputs:<n>_records` | any queued record has missing inputs |
| `unrecognized_failure_code:<code>` | recovery default applied |
| `failed_at_in_future:<invoice_id>` | `failed_at > as_of` (days clamped to 0) |
| `empty_scope` | filters matched no record |
| `truncated:top_n=<n>` | a queue was cut by `top_n` |

## 5. Agent pipeline

### 5.1 Sequence

```text
question + datasetId
  1. plan       LLM -> AnalysisPlan (validated)        -> SSE "plan"       (shown to user BEFORE code runs)
  2. codegen    LLM -> main.py                         -> SSE "code"
  3. guard      static checks on main.py (§5.4)        -> SSE "guard"
  4. sandbox    upload + run (§6)                      -> SSE "sandbox"
  5. validate   stdout -> JSON -> zod + checks (§4.1)  -> SSE "result"
  on any failure in 2-5: one regeneration with the error (§5.5), then fail visibly
```

**The LLM never sees customer records.** It receives the question, the dataset column names and allowed values, the library API, and aggregate counts only. Records reach the data only inside the sandbox. The LLM also never produces numbers shown to the user: all figures come from the validated sandbox output.

### 5.2 `AnalysisPlan`

```ts
interface AnalysisPlan {
  intent: "rank_recoverable" | "failure_reasons" | "in_recovery" | "unsupported";
  filters: {
    failed_within_days?: number;     // int 1..365, relative to as_of
    min_amount_minor?: number;       // int >= 0
    currency?: string;               // 3 letters, lowercase
    states?: State[];                // restricts queued states
    failure_codes?: string[];
    priority_at_least?: Priority;
  };
  group_by: Array<"failure_code" | "state">;   // which breakdown tables the script must populate (by_currency is always populated)
  top_n: number;                     // int 1..50, default 10
  then_draft: boolean;               // UI opens the draft flow for the top items; never sends anything
  explanation: string;               // <= 400 chars, plain language, shown to the user before execution
  fields_used: string[];             // subset of the CSV columns
  unsupported_reason?: string;       // required when intent = "unsupported"
}
```

`intent: "unsupported"` is the safe outcome for anything outside scope (changes since yesterday, sending, retrying, canceling, unrelated questions, prompt-injection attempts). The API returns `422 UNSUPPORTED_REQUEST` with `unsupported_reason`, and no code is generated. "What changed since yesterday?" is Journey D and is a stretch goal that needs a second snapshot; until then it is unsupported.

### 5.3 Library (`sandbox/recoverly_lib.py`)

Standard library only. The generated script is **not** allowed to reimplement scoring; it calls:

| Function | Contract |
| --- | --- |
| `load(path="data.json") -> (as_of: datetime, records: list[dict])` | Reads the input file (the only file the script may read, through this function) |
| `build_context(records, as_of) -> ctx` | Computes `max_amount[currency]` over all queued records of the full dataset |
| `enrich(record, ctx) -> item` | Applies §3.1 to §3.6 to **every** record, resolved ones included. The item is a dict with all `QueueItem` fields plus `state`; resolved items have `priority = None`, `score = None`. Every item carries `days_since_failure`, `amount_minor`, `currency`, `state`, `failure_code` so a filter can be written over items |
| `rank_queues(items, top_n) -> (queues, truncated: dict)` | Splits queued from resolved items, applies §3.4 |
| `metrics(items) -> dict` | The `metrics` object of §4.1 |
| `build_result(plan, as_of, records_total, items, queues, truncated, extra_warnings) -> dict` | Assembles §4.1 including `summary`, `warnings`, `data_quality`, and the `resolved` list |

There is deliberately **no filter function in the library**. The generated script must write the plan-filter logic itself (days window, minimum amount, currency, states, failure codes, priority threshold), because that is the question-specific code the agent is responsible for. The reference shape is in [agent-prompts.md §2](agent-prompts.md). The generated script also reads the plan embedded as a literal, applies it, calls the library for scoring/ranking/assembly, and prints `json.dumps(result)`. It must print **only** the JSON object to stdout; diagnostics go to stderr.

Precision rule: `enrich` returns **unrounded** `days_since_failure` and the unrounded component values internally, and `build_result` rounds for output (§3.2). Filters therefore compare against unrounded values, so a script's filter and the server's re-check (§4.1) can never disagree at a boundary. The one exception is `score`, which `enrich` rounds to 1 decimal immediately because tiers are defined on the rounded score (§3.3).

Semantics the filter must implement (and the server re-checks, §4.1): `failed_within_days: N` keeps items with `days_since_failure <= N`; `min_amount_minor` keeps `amount_minor >= value`; `currency` and `failure_codes` are exact (lowercase) matches; `states` keeps items whose `state` is listed (resolved states are kept only if listed); `priority_at_least` keeps items whose `priority` is at or above the tier and drops resolved items (they have no priority). `records_in_scope` is the number of items kept.

### 5.4 Static guard (defense in depth; the sandbox is the real boundary)

Reject (`GUARD_REJECTED`, shown in the run log) when any of these hold for the generated `main.py`:

- longer than 300 lines or 12 KB;
- an `import`/`from` of any module outside the allowlist `json, sys, datetime, math, statistics, collections, itertools, functools, decimal, typing, re, recoverly_lib`;
- any of these tokens, matched as whole identifiers with a `\b` word boundary (so `pos.x` does not trip `os.`): `__import__`, `eval(`, `exec(`, `compile(`, `open(`, `input(`, `subprocess`, `socket`, `os.`, `importlib`, `ctypes`, `builtins`, `globals(`, `locals(`, `getattr(`, `setattr(`, `urllib`, `http`;
- any dunder name other than `__name__` and `__main__`;
- no `recoverly_lib` import, or no `print(` of JSON (cheap sanity checks that catch non-answers).

The guard runs on the server before upload. It is expected to be bypassable by a determined adversary; that is why §6 isolation and §9 exist.

### 5.5 Failure handling and retry

- Planner output fails `zod`: regenerate once with the validation error, then `LLM_UNAVAILABLE`/`UNSUPPORTED_REQUEST` as appropriate.
- Guard rejection, non-zero exit, timeout, invalid JSON, or `RESULT_INVALID`: **one** regeneration with the error appended (stderr tail at most 2 KB). Temperature 0.2.
- After the retry fails: respond with `GENERATION_FAILED` including every attempt's status. Never return a result that did not pass validation.
- Sandbox infrastructure errors (`SANDBOX_*`) are **not** retried by regeneration; they are reported (the code is not at fault).

### 5.6 Replay (demo safety net)

`sandbox/replay/rank_recoverable.py` holds a script that previously passed all validations (captured from a real generation, committed as a file). The request flag `replay: true` runs it through the **same** guard, sandbox and validation. The UI and run log label it `source: "replay"` ("replayed saved script, not freshly generated"). Replay is never used silently as a fallback.

### 5.7 LLM client

OpenAI-compatible Chat Completions. Planner: JSON object output (`response_format: {type: "json_object"}`; **UNVERIFIED** for the chosen model; fall back to "reply with JSON only" plus tolerant extraction). Codegen: a single fenced python block, extracted by regex; anything else is a generation failure. Timeouts: planner 45 s, codegen 60 s. `max_tokens`: 800 planner, 2000 codegen. No streaming required. Secrets are read from env only, never logged.

## 6. Sandbox runner

Facts below were read from the SDK v0.8.2 type definitions and docs; behaviours marked UNVERIFIED need a live check.

| Topic | Fact |
| --- | --- |
| Client | `createClient()` reads `CREATEOS_SANDBOX_API_KEY`; base URL defaults to `https://api.sb.createos.sh` |
| Create | `createSandbox({ shape, rootfs, name, egress, auto_pause_after_seconds })` blocks until `running`. Names are unique per user. |
| Run | `sandbox.runCommand(cmd, args)` returns `{ result: { stdout, stderr, exit_code, error? }, exec_ms }`. A non-zero exit **does not throw**. `cmd` is not run through a shell; use `["bash","-c",...]` for compound commands. |
| Files | `sandbox.files.upload(absPath, content)` and `files.download(absPath)` (returns an `ArrayBuffer`). Parent directories must be created first with `mkdir -p` (**UNVERIFIED** that upload does not create them). |
| Timeouts | SDK `timeoutMs` is an HTTP request timeout (default 60 s), **not** a process limit. Enforce the real limit inside the sandbox with GNU `timeout -k 2 <s>`; exit code 124 = timed out. |
| Egress | `setEgress(["host:port"])`; empty, `null` or `["*"]` mean **allow all**; any other list is allowlist-only. Plan: one closed-loopback rule (`127.0.0.1:9`) blocks outbound traffic. **UNVERIFIED** until the spike passes. |
| Lifecycle | `pause()`, `resume()`, `destroy()`, `listSandboxes()`, `waitUntilRunning()`; idle auto-pause 60 to 86400 s |
| Errors | `CreateosSandboxPaymentRequiredError` (402), `...RateLimitError` (429), `...PermissionError` (403, quota), `...AuthError` (401), `...NotFoundError` (404), `...TimeoutError`, `...ConnectionError`, `...ServerError` (5xx) |
| Free plan | 1 concurrent sandbox, 10 creates per day, largest shape 1 vCPU / 1 GB, new accounts get 500 credits |

Design:

- **One shared named sandbox**: `recoverly-runner`, shape `s-1vcpu-1gb`, rootfs `devbox:1`, `auto_pause_after_seconds: 900`. Acquire by name via `listSandboxes()` (resume if paused); create only if absent. Cache the handle on `globalThis` so hot reloads do not leak sandboxes. Re-apply the egress lock on every acquire. On `NotFoundError`, drop the cache and reacquire once.
- **Per-job directory** `/tmp/recoverly-jobs/<uuid>/` containing `recoverly_lib.py`, `data.json`, `main.py`. Generated code is uploaded as a file and **never interpolated** into a command string. Remove the directory afterwards (best effort).
- **Command**: `bash -c "cd <jobdir> && timeout -k 2 <N> python3 -s main.py"`; `N` default 20, max 120.
- **Output cap**: 256 KB for stdout and stderr, truncated with a marker (truncated JSON then fails validation, which is the desired behaviour).
- **Serialize runs** with a promise queue (1 vCPU).
- **Return value** is data, never an exception: `{ status: "ok" | "nonzero_exit" | "timeout" | "sandbox_error", exitCode, stdout, stderr, execMs, sandboxId, error? }`.
- Do not put secrets in the sandbox environment (`envs`). Send only `data.json` columns from §2.4.
- Error mapping for the API: 402 maps to `SANDBOX_OUT_OF_CREDIT`, 429 to `SANDBOX_RATE_LIMITED`, 403 to `SANDBOX_RATE_LIMITED` with the quota hint, 401 to `SANDBOX_UNAVAILABLE` (bad key), timeout status to `SANDBOX_TIMEOUT`, other to `SANDBOX_EXEC_FAILED` or `SANDBOX_UNAVAILABLE`.

## 7. HTTP API

All bodies are JSON unless stated. **Naming:** API request/response envelopes and SSE payloads use `camelCase`; the `AnalysisResult` object (§4.1) is passed through exactly as the sandbox produced it, in `snake_case`. All errors use the envelope `{ "error": { "code": string, "message": string, "details"?: unknown[] } }`. If `RECOVERLY_ACCESS_CODE` is set, every route except `GET /api/health` requires header `x-access-code`. Max question length 500 chars; in-memory rate limit of 20 analyses per hour per IP (`429 RATE_LIMITED`).

| Route | Request | Success response |
| --- | --- | --- |
| `GET /api/health` | none | `{ ok: true, app: "recoverly", config: { sandbox: boolean, llm: boolean, sendEnabled: boolean } }` (booleans only, never values) |
| `POST /api/data/load` | `{ "source": "fixture" }` or `multipart/form-data` with a `file` field (CSV) | `200 { datasetId, source: "fixture"\|"upload", synthetic: boolean, asOf, rows, currencies: string[], warnings: string[] }` |
| `POST /api/analyze` | `{ datasetId, question, replay?: boolean }` | `200 text/event-stream` (below) |
| `POST /api/draft` | `{ analysisId, invoiceId, tone }`, tone in `concise\|friendly\|professional` | `200 DraftView` (see ui-and-drafting-spec §3) |
| `POST /api/draft/:draftId/approve` | `{ nonce, confirm: true, editedBody? }` | `200 { status: "approved_not_sent"\|"sent"\|"send_failed", auditId }` |
| `GET /api/audit` | none | `200 { entries: AuditEntry[] }` (most recent first, max 200) |

`POST /api/analyze` events (each `event: <name>` + `data: <json>`):

| Event | Payload |
| --- | --- |
| `plan` | `{ analysisId, plan }` |
| `code` | `{ attempt: 1\|2, source: "generated"\|"replay", code: string }` |
| `guard` | `{ attempt, ok: boolean, violations: string[] }` |
| `sandbox` | `{ attempt, status, exitCode, execMs, sandboxId (first 8 chars), stderrTail (<= 2 KB) }` |
| `result` | `{ analysisId, result: AnalysisResult }` |
| `error` | `{ code, message, details? }` (terminal) |
| `done` | `{}` (terminal; always sent last unless the stream broke) |

Server state is in memory, keyed by random ids (`datasetId`, `analysisId`, `draftId`), on `globalThis`. This **assumes a long-lived Node server** (`next start`). **UNVERIFIED** for the CreateOS deployment target; if the host is serverless, fixture mode still works statelessly (the fixture is rebuilt from the bundled CSV when `datasetId = "fixture"`), and uploaded datasets and drafts would need persistent storage.

## 8. Errors and visible failure behavior

Each must surface in the UI as a specific, non-success-shaped message (spec §16).

| `code` | HTTP | Trigger | User-facing behavior |
| --- | ---: | --- | --- |
| `CSV_INVALID` | 400 | §2.2 | Table of row/column problems; nothing imported |
| `DATASET_NOT_FOUND` | 404 | unknown `datasetId` | Prompt to reload data |
| `UNSUPPORTED_REQUEST` | 422 | `intent = unsupported` | Show `unsupported_reason` and example questions |
| `LLM_UNAVAILABLE` | 502 | provider error/timeout | Integration error; offer replay mode |
| `GENERATION_FAILED` | 502 | both attempts failed (guard/exit/JSON/schema) | Show each attempt and its error |
| `SANDBOX_UNAVAILABLE` | 502 | cannot create/reach/authenticate | Integration error |
| `SANDBOX_RATE_LIMITED` | 429 | cap/quota | Explain free-plan limits |
| `SANDBOX_OUT_OF_CREDIT` | 402 | 402 from CreateOS | Tell the operator to top up |
| `SANDBOX_TIMEOUT` | 504 | exit 124 | Show timeout |
| `SANDBOX_EXEC_FAILED` | 502 | non-zero exit, no retry left | Show stderr tail |
| `RESULT_INVALID` | 502 | §4.1 validation | "Rejected malformed output" with the failed check |
| `DRAFT_NOT_ELIGIBLE` | 409 | action `wait_for_retry`/`do_not_pursue`, or paid since | Explain why no message is needed |
| `APPROVAL_INVALID` | 403 | bad nonce, `confirm` not `true`, already used, or draft expired | Nothing is sent or recorded as approved |
| `SEND_FAILED` | 502 | adapter failure | Approved draft is preserved for retry |
| `RATE_LIMITED` | 429 | per-IP limit | Retry-after hint |

Other spec §16 rows: **missing retry information** lowers confidence (§3.3), never assumed to mean "no retry"; **currency mismatch** is handled by per-currency queues and metrics; **customer already paid** is handled by `paid` records being resolved (re-running the analysis on a refreshed dataset removes them from queues); **duplicate events** are out of scope for the CSV-only MVP and would be deduplicated by Stripe event id in a webhook adapter.

## 9. Security requirements (acceptance criteria, not suggestions)

1. No secret ever reaches the browser, the LLM prompt, the sandbox, logs, or a thrown error message.
2. The LLM prompt never contains customer records or emails.
3. Raw emails never leave the server except inside an approved draft body addressed to that customer (and the MVP does not send).
4. The default mode has no side effects: no payment, subscription, invoice or message action exists in the API. Drafts are inert until an explicit approval, and approval in the MVP records the decision but sends nothing.
5. Imported data is untrusted: validated, never executed, rendered with React escaping (no `dangerouslySetInnerHTML`).
6. Generated code runs only in the sandbox with egress locked, a hard timeout, and capped output; it is validated before and its output is validated after.
7. `.env`, `.projects/vault/` and any `*.log` are git-ignored; nothing with real customer data is committed (fixtures are synthetic).
8. The public demo can be locked with `RECOVERLY_ACCESS_CODE` and is rate limited.

## 10. Testing

| Layer | What | Notes |
| --- | --- | --- |
| Unit: CSV | every row in [fixture-spec §7](fixture-spec.md), plus masking | no network |
| Unit: scoring | run `recoverly_lib.py` on the fixture and compare to fixture-spec Golden A and B with the stated tolerances | Python must be runnable locally or in the sandbox. **This machine has no real Python install**; install Python 3.12 or run the golden test in the sandbox (integration). |
| Unit: guard | accepts the replay script; rejects each denylist item and each non-allowlisted import | |
| Unit: validation | rejects wrong ranks, unsorted scores, unknown `invoice_id`, negative or non-integer minor units, cross-currency items | |
| Unit: drafting | content checks and templates (ui-and-drafting-spec §4) | |
| Pipeline with stub LLM | stub returns the replay script; assert the SSE event order and the final `AnalysisResult` equals Golden B | |
| Integration (opt-in `RUN_SANDBOX_TESTS=1`) | the spike checks: python runs, `timeout` available, non-zero exit surfaced, timeout enforced, egress blocked, reuse by name does not create a second sandbox | spends at most one sandbox create |
| Smoke after deploy | `GET /api/health`, load fixture, run the demo question, draft and approve one message | script in `scripts/smoke.sh` |

## 11. Unverified items to resolve during the build

1. Names of the credential variables Stripe Projects writes for CreateOS and the LLM provider.
2. LLM model slug, JSON-mode support and cost on the chosen provider.
3. Whether a single closed-loopback egress rule fully blocks outbound traffic (spike).
4. Whether `files.upload` creates parent directories.
5. `createos deploy` on Windows (CLI documents macOS and Linux only); fallback ladder in implementation-plan §9.
6. Whether the deployment host keeps in-memory state between requests and passes through SSE unbuffered.
7. Leaderboard submission mechanics at `projects.dev/leaderboard` (code `CreateOS-2026`).
8. Stretch (Stripe live read): the current Invoice object carries the subscription under `parent` rather than a top-level field, and payment-error details come from the PaymentIntent; confirm the exact expansions before writing an adapter.
