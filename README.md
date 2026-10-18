# Recoverly

**Explainable failed-payment recovery for small subscription businesses.** Recoverly turns a failed-payment export into a prioritized recovery queue. For each failed payment it says what failed, how much revenue is at risk, and the safest next step, and it drafts a customer message that a human must approve. The analysis is performed by **code the agent writes at request time and runs inside a CreateOS Sandbox**.

Built for the CreateOS x Stripe "Build Agents That Run Code" hackathon.

- Demo video: _add the YouTube link here_
- Live app: https://recoverly-mu.vercel.app (also on CreateOS: https://production-recoverly.tyzo.nodeops.app, an older build because the CreateOS plan allows only two deployments)
- All data in this repository is **synthetic**.

## How it works

```text
question -> plan (LLM) -> code (LLM) -> static guard -> CreateOS Sandbox -> validated JSON -> ranked queue
                                                               |
                            server re-checks the output against the plan; nothing unverified is shown
```

1. You ask a question in plain language ("Find the failed payments from the last seven days with the highest recoverable revenue").
2. The agent shows its plan, then writes a short Python script that applies the plan's filters and calls a fixed, tested scoring library (`sandbox/recoverly_lib.py`).
3. The script runs in an isolated CreateOS Sandbox with network access locked (`EGRESS_DENY_ALL`) and a hard timeout.
4. The server validates the output schema, **re-checks the output against the raw dataset and the plan** (no invented customers, no silently dropped records, plan filters honored), and only then renders the queue. One automatic retry feeds the error back to the model.
5. Each row explains its priority: the weighted score breakdown, which facts are Stripe-shaped data and which are agent inferences, and what is uncertain.
6. A drafted message goes through content checks and needs explicit approval. **In this version nothing is ever sent or charged.**

Scoring weights are frozen in code (amount 0.45, recovery 0.25, urgency 0.20, customer value 0.10). Money stays in integer minor units and is never summed across currencies. The score is a **heuristic for triage, not a prediction of recovery**.

## Where the hackathon technologies are used

| Technology | Use |
| --- | --- |
| **CreateOS Sandbox** | Runs every piece of agent-written analysis code (`src/lib/sandbox/runner.ts`): one reused named sandbox, uploaded job files, egress locked, `timeout`-enforced, output capped |
| **Stripe Projects** | Provisions the project, the CreateOS service and credentials (`stripe projects init`, `add createos/project`, `env --pull` writes `.env`); see `.projects/` (git-ignored) |
| **Stripe data model** | Input follows the Stripe Invoice / PaymentIntent decline-code model; recommendations favor Stripe-hosted recovery pages and leave retries to Stripe Smart Retries |

## Safety model

- Read-only analysis; no payment, subscription, or messaging action exists in the API.
- The LLM never sees customer records, emails or scores; all figures come from validated sandbox output.
- Generated code is statically guarded before it runs (import allowlist, denied calls, size limits) and its output is verified after.
- Customer emails are masked before they enter the sandbox, the UI, logs or the audit log. The raw address is used server-side only to address an approved draft.
- Drafts use a small allowed-field set, pass ten content checks (amount, link, no threats, no internal data, ...), fall back to a deterministic template, and need a single-use, 30-minute approval nonce. Audit entries store a hash and length, never the body.
- Declines whose real reason Stripe says not to disclose (lost, stolen, fraud, blocked) read as a generic decline to customers.
- Optional shared passcode (`RECOVERLY_ACCESS_CODE`) and a per-IP rate limit protect a public demo.

## Run it

Prerequisites: Node.js 24+, a CreateOS account (via Stripe Projects), an LLM provider key (OpenRouter by default).

```bash
npm install
cp .env.example .env     # fill in the names listed there; never commit .env
npm run dev              # http://localhost:3000
```

Try it: click **Load demo data**, then **Run analysis** on the first example question. Open a row for the evidence, then **Draft message** to see the approval flow. Tick **Replay saved script** to run the saved script without the LLM.

Credentials come from Stripe Projects: `stripe projects add createos/project` and your LLM provider, then `stripe projects env --pull` writes the variables below into `.env`.

| Variable | Purpose |
| --- | --- |
| `CREATEOS_PROJECT_API_KEY` (or `CREATEOS_SANDBOX_API_KEY`) | CreateOS Sandbox auth |
| `CREATEOS_SANDBOX_BASE_URL` | Sandbox control plane (default `https://api-eu.sb.createos.sh`) |
| `OPENROUTER_API_KEY` | LLM auth |
| `RECOVERLY_MODEL` | Model slug (default `openai/gpt-4o-mini`) |
| `RECOVERLY_LLM_BASE_URL` | OpenAI-compatible endpoint (default OpenRouter) |
| `RECOVERLY_ACCESS_CODE` | Optional passcode for a public demo (`x-access-code` header) |
| `RECOVERLY_ENABLE_SEND` | Delivery stays off unless this is exactly `true`; no delivery adapter ships |
| `BUSINESS_NAME`, `SUPPORT_CONTACT` | Used in drafted messages |

### Deploy

Set the secrets (`CREATEOS_PROJECT_API_KEY`, `OPENROUTER_API_KEY`, optionally `RECOVERLY_ACCESS_CODE`) in the host's dashboard, never in the repo. The other variables have defaults in the table above.

- **Render (recommended).** `render.yaml` is a blueprint: New > Blueprint, pick this repo, fill the three secrets. It runs `next start` on a long-lived Node service with `/api/health` as the health check. The free plan sleeps when idle and loses in-memory state on restart.
- **Vercel.** `vercel.json` pins the Frankfurt region (next to the EU sandbox endpoint); import the repo, add the same env vars, deploy. `/api/analyze` already sets `maxDuration = 120`, which needs a plan that allows it. Functions are serverless, so in-memory state is not guaranteed to persist between requests: the bundled demo dataset and analysis work, but uploaded datasets and the analyze-then-draft-then-approve flow can lose state on a cold start or another instance. Use Render for the full flow.

### Commands

```bash
npm run typecheck        # tsc --noEmit
npm test                 # unit, golden, pipeline, route and drafting tests (no network)
npm run test:sandbox     # opt-in live checks against the real CreateOS Sandbox
npm run spike:sandbox    # sandbox capability spike (python, timeout, egress, reuse)
npm run analyze -- "What are the top failure reasons?"   # whole agent from the CLI (add --replay)
npm run smoke -- http://localhost:3000                  # end-to-end smoke (add --replay to skip the LLM)
npm run capture:golden   # regenerate tests/fixtures/golden-*.json from the sandbox
npm run build && npm start
```

### CSV format

Header row with these columns (extra columns are ignored): `customer_id, customer_email, invoice_id, subscription_id, amount_due, currency, failure_code, failure_message, failed_at, attempt_count, next_payment_attempt, invoice_status, customer_created_at, hosted_invoice_url`. `amount_due` is an integer in minor units; `next_payment_attempt` is a timestamp (retry scheduled), empty (none scheduled) or `unknown`; `invoice_status` is `open|paid|uncollectible|void`. Up to 5000 rows and 1 MB. See `data/fixtures/failed_payments.csv` and `docs/technical-spec.md` section 2.

## Project structure

```text
sandbox/recoverly_lib.py           fixed scoring library uploaded to the sandbox (stdlib only)
sandbox/replay/rank_recoverable.py saved script for the labeled replay mode
data/fixtures/failed_payments.csv  synthetic 13-row demo dataset
src/app/                           dashboard (src/app/_components) and API routes
src/lib/domain/                    CSV parsing and masking, schemas, money formatting
src/lib/agent/                     planner, code generator, static guard, pipeline, result validation, LLM client
src/lib/sandbox/runner.ts          CreateOS Sandbox runner
src/lib/drafting/                  content checks, templates, drafts, approval, audit
src/lib/client/                    browser API helpers and the pipeline state reducer
tests/                             vitest suites and golden fixtures
scripts/                           CLI, smoke test, sandbox spike, golden capture
docs/                              specs, prompts, golden results, build notes
```

HTTP API: `GET /api/health`, `POST /api/data/load`, `POST /api/analyze` (server-sent events: plan, code, guard, sandbox, result, error, done), `POST /api/draft`, `POST /api/draft/:id/approve`, `GET /api/audit`.

## Limitations

- Synthetic demo data; no live Stripe account is read (CSV import only).
- The priority score is a transparent heuristic, not a prediction of recovery.
- Message delivery is intentionally not implemented; approval records the decision only.
- State (datasets, analyses, drafts, audit) is in memory, so a server restart clears it; the audit log is also appended to `.recoverly/audit.jsonl` where the filesystem allows. Deploy to a long-lived Node host (`next start`).
- "What changed since yesterday?" needs a second snapshot and is reported as unsupported.

## Documentation

Product spec, technical spec, fixture and golden results, prompts: see [`docs/`](docs/).
