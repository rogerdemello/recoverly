# Recoverly — Failed Payment Recovery Agent

**CreateOS × Stripe hackathon project.** Recoverly is a recovery-desk AI agent: an operator asks a plain-English question about failed subscription payments, an LLM plans the analysis, Recoverly generates a short Python script, that script runs sandboxed in a [CreateOS Sandbox](https://createos.sh) with network access disabled, and only validated JSON comes back — a ranked, explained recovery queue with fixed, non-LLM scoring weights.

```
question → plan (JSON) → generated Python → CreateOS Sandbox → validated ranked result
```

## What it does

- **NL question → structured plan.** Filters (amount in minor units, currency, failure codes, recency), metrics, rank-by, top-N — parsed and validated with zod.
- **LLM writes the code, not the scores.** The model emits a short script that uses the audited helper library `recoverly_lib.py`. Scoring weights are frozen in code: amount 0.45, recovery 0.25, urgency 0.20, customer_value 0.10.
- **CreateOS Sandbox execution.** The plan, fixture data, helper library, and generated script are uploaded to a sandbox; `EGRESS_DENY_ALL` blocks network egress; a 30s timeout caps runaway code.
- **Static guard + schema validation.** Generated Python is checked against a denylist (no sockets, subprocess, file writes, etc.) before it ever runs. Stdout must be a single JSON document matching `AnalysisResult`. One automatic retry feeds sandbox errors back to the model.
- **PII minimization.** `customer_email` is stripped before the dataset enters the sandbox.

## Quick start

```bash
npm install

# Stripe Projects (manages the .env credentials — do not hand-edit .env)
# Requires stripe CLI with the projects plugin, logged into the hackathon account.
stripe projects env --pull

# Sanity-check the CreateOS sandbox (reuses the named sandbox if it exists)
npm run spike:sandbox

# Ask a question end-to-end (plan → code → sandbox → ranked result)
npm run analyze -- "Find the failed payments with the highest recoverable revenue. Explain the reason and recommend the next safe action."

npm run typecheck
npm test
```

### Required environment (pulled via Stripe Projects)

| Variable | Purpose |
| --- | --- |
| `CREATEOS_PLAN_API_KEY` / `CREATEOS_PLAN_BASE_URL` | CreateOS plan (free tier) control plane |
| `CREATEOS_PROJECT_API_KEY` / `CREATEOS_PROJECT_API_URL` | CreateOS project API |
| `OPENROUTER_API_KEY` | LLM access (default model `openai/gpt-4o-mini`, override with `RECOVERLY_MODEL`) |

The sandbox SDK reads `CREATEOS_SANDBOX_API_KEY` (falls back to `CREATEOS_PROJECT_API_KEY`) and `CREATEOS_SANDBOX_BASE_URL` (defaults to `https://api-eu.sb.createos.sh`).

## Repository layout

| Path | Role |
| --- | --- |
| `scripts/run-analysis.ts` | CLI agent: question in, ranked queue out |
| `scripts/sandbox-spike.ts` | Sandbox capability spike (Python, timeout, egress, reuse) |
| `src/lib/analysis/agent.ts` | Agent loop: plan → codegen → guard → sandbox → validate → retry |
| `src/lib/analysis/llm.ts` | OpenRouter chat (JSON + code modes) |
| `src/lib/analysis/guard.ts` | Static guard for generated Python |
| `src/lib/analysis/schemas.ts` | zod contracts: `AnalysisPlan`, `AnalysisResult` |
| `src/lib/analysis/recoverly_lib.py` | Fixed scoring library uploaded to the sandbox |
| `src/lib/sandbox/runner.ts` | CreateOS sandbox client, egress deny-all, job runner |
| `data/fixture-failed-payments.json` | Synthetic 20-row fixture (USD + EUR) — not real customer data |
| `docs/` | Spec, implementation plan, submission checklist |

## Safety model

- Generated code never touches the network (`EGRESS_DENY_ALL`) and is static-guarded before upload.
- Scoring weights are TypeScript/Python constants, never LLM outputs.
- Amounts stay in minor units; multi-currency totals are grouped, never summed together.
- Synthetic fixture only; emails stripped pre-sandbox.

## Docs

- [Project spec](docs/failed-payment-recovery-agent.md)
- [Technical spec](docs/technical-spec.md)
- [Implementation plan](docs/implementation-plan.md)
- [Submission checklist](docs/submission-checklist.md)
