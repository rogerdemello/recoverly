# Recoverly: Implementation Plan

Companion to the [project specification](failed-payment-recovery-agent.md). The spec defines *what* to build; this plan defines *how and in what order*, given the hard **5:30 PM PT submission lock**.

## 1. What the platform docs changed (verified Oct 17)

| Finding | Source | Impact on the plan |
| --- | --- | --- |
| Free CreateOS plan: **1 concurrent sandbox, 10 creates/day**, largest shape 1 vCPU / 1 GB; create over the cap returns `429` | [Limits](https://createos.sh/docs/Sandbox/Limits/) | Reuse **one** sandbox per session; never create-per-request. Do not burn the daily quota in testing. |
| `devbox:1` image ships Python 3.12, Node 24, pandas | Limits | Generated analysis code is **Python**; no install step needed. |
| Egress is **open by default**; once any rule exists only listed destinations are allowed | Limits | The spec's "no network for CSV analysis" requires an explicit rule. Confirm the rule syntax early. |
| SDK: `createClient()` (env `CREATEOS_SANDBOX_API_KEY`), `createSandbox({shape, rootfs})`, `files.upload/download`, `runCommand(cmd, args)` → `result.stdout`, `streamCommand`, `destroy()` | [SDK overview](https://createos.sh/docs/Sandbox/SDK/Overview) | Docs do not show `exitCode`, `stderr`, or timeouts on `runCommand`. **Spike required.** |
| `stripe projects add createos/project` creates the CreateOS account and writes credentials to `.env`; `createos deploy` reads `.env` | [CreateOS × Stripe Projects](https://createos.sh/docs/Services/Stripe-Projects.md) | Env var names are undocumented; run `stripe projects env` to discover. What `createos deploy` expects from a project is undocumented. **Spike required.** |
| Stripe Projects provisions third-party services (incl. OpenRouter, Neon, Resend); it is **not** the Stripe Billing API | [Stripe Projects](https://docs.stripe.com/projects) | Stripe billing data (invoices/PaymentIntents) is a separate, optional integration. |
| Judging criteria are **not published** | [Hackathon page](https://createos.sh/hackathon) | Optimize for what is verifiably required plus a clear, working, visible demo. |

## 2. Decisions

| Decision | Default | Why |
| --- | --- | --- |
| App stack | **Next.js (App Router, TypeScript)**, one deployable | SDK is TypeScript; one repo/one deploy minimizes surface area. |
| Sandbox language | **Python 3.12** (pandas available) | Already in `devbox:1`. |
| LLM provider | **OpenRouter via `stripe projects add`** (Claude model), Anthropic API key as fallback | Deepens real Stripe Projects usage and delivers the key through `.env`. Confirm free tier with `stripe projects catalog openrouter`. |
| Data source (P0) | **Synthetic Stripe-shaped CSV fixture** | Spec risk table: do not spend the day on a live Stripe integration. |
| Data source (stretch) | Stripe test-mode seed + read adapter | Only after the core loop works. |
| CreateOS plan | **Free**, one reused sandbox | Upgrading to Beginner ($10/mo) is a paid purchase and needs your explicit approval. |
| Persistence | In-memory + append-only JSON audit log | No database needed for the MVP. |

## 3. Architecture (build target)

```
Browser ──► Next.js API (server only; holds all secrets)
              │
              ├─ planner (LLM)      NL request ─► typed AnalysisPlan (zod)
              ├─ codegen (LLM)      plan ─► Python script (contract: print one JSON doc)
              ├─ static guard       denylist (socket/subprocess/os.system/requests/…); size cap
              ├─ sandbox runner     CreateOS SDK: upload data.json + recoverly_lib.py + script.py,
              │                     run with timeout, capture stdout/stderr/exit status
              ├─ validator (zod)    summary / metrics / ranked_items / warnings / data_quality
              ├─ drafter (LLM)      approved fields only ─► message draft
              └─ action guard       approval token required; delivery disabled by default; audit log
```

**Key design choice: the LLM writes the task-specific script, but the scoring heuristic lives in a fixed, tested `recoverly_lib.py` uploaded alongside it.** The model decides filters, grouping, and which questions to answer; the weights from spec §9 are never regenerated. That keeps the demo deterministic while the "agent writes and runs its own code" requirement stays literally true.

**Failure path:** one automatic retry that feeds the validation/stderr error back to the model. If it still fails, show the failure. A cached known-good script for the demo question may be offered as a manual "replay" and **must be labeled as a replay**, never presented as fresh generation.

**Sandbox hygiene:** upload only the needed columns; mask emails before upload (the drafter resolves real addresses server-side by `customer_id`); egress locked to an empty/denied set; enforce timeout; never place secrets in the sandbox env.

## 4. Scoring details to settle in M1

Weights come from spec §9 (`0.45 amount + 0.25 recovery + 0.20 urgency + 0.10 customer value`). Remaining design work:

- **`failure_code` → recovery signal and action**, e.g. `expired_card` (customer action needed, recoverable), `insufficient_funds` (retry may succeed; wait if scheduled), `authentication_required` (customer action via hosted page), `generic_decline` (ambiguous, lower confidence), `lost_card`/`stolen_card` (do not retry; contact customer). Codes must be checked against the Stripe decline-code docs before finalizing.
- **Normalization:** amount normalized within the dataset **per currency**; never sum across currencies.
- **Missing inputs** reduce a `confidence` field and are listed per item; nothing is silently defaulted.
- Every output field tagged `source: "stripe_fact" | "agent_inference"` for spec FR-8.

## 5. Timeline (Pacific Time; IST in parentheses)

Hard lock **5:30 PM PT (6:00 AM IST, Oct 18)**. Late commits do not count.

| Window | Milestone | Gate to pass |
| --- | --- | --- |
| 12:30–1:00 PM (1:00–1:30 AM IST) | **M0 Foundation + spikes** | You: install CLIs, `stripe projects init`, `stripe projects add createos/project`, `createos login`. Me: scaffold app; hello-world Python executed in a sandbox **from app code**; `runCommand` result shape, timeout and egress-rule syntax confirmed; `createos deploy` of a hello-world; leaderboard sign-up process checked (`projects.dev/leaderboard`, code `CreateOS-2026`). |
| 1:00–1:45 | **M1 Data + deterministic core** | Fixture CSV (8 required cases, ~20 rows, clearly synthetic); `recoverly_lib.py` + local tests; output schema + zod validators. |
| 1:45–3:00 | **M2 Agent loop (no UI)** | One command: NL question → plan → generated code → sandbox → validated ranked JSON. Retry path and failure messages work. |
| 3:00–3:50 | **M3 Dashboard** | Metrics, ranked queue, detail view with evidence + fact/inference tags, visible generated code, run log. |
| 3:50–4:15 | **M4 Draft + approval** | Tone picker, draft, approval step, audit log; send path disabled by default. |
| **4:15** | **Feature freeze** | Anything unfinished is cut, not rushed. |
| 4:15–4:30 | Final deploy + failure-state pass | Deployed URL works end to end; invalid CSV, sandbox error, and malformed output each show a visible error. |
| 4:30–5:00 | Demo + README | 2–3 min recording with a team member on camera (follow spec §19), uploaded to YouTube. README written incrementally during the day. |
| 5:00–5:20 | Submit | Public repo, public X/LinkedIn post (tag `@createosai` / mention CreateOS), leaderboard entry, form. Target submission by 5:15 to leave a 15-minute buffer. |

**Stretch, only if M2 is done by 3:00:** Journey D ("what changed since yesterday" using a second snapshot) → Stripe test-mode seed + read adapter.

**Cut order if behind:** Journey D → Stripe live read → detail-view polish → tone options. Never cut: visible generated code, sandbox execution, approval gate, deployment, demo, README.

## 6. If there are teammates (up to three)

- **A, Agent + sandbox:** planner/codegen/runner/validator (M0 sandbox spike, M2).
- **B, Data + scoring:** fixture, `recoverly_lib.py`, tests, drafter prompts (M1, M4).
- **C, UI + submission:** dashboard, deployment, README, demo recording, post, leaderboard (M3, final hour).

Contract between A/B/C is the output schema from M1; agree on it first.

## 7. Risks specific to this plan

| Risk | Mitigation |
| --- | --- |
| `createos deploy` expectations are undocumented | Deploy a hello-world in M0, not at 4 PM. |
| Free-plan sandbox cap (`429`) hits mid-demo | One reused sandbox; keep the daily 10-create budget; test with the CLI sparingly; have the Beginner upgrade decision made before the demo. |
| LLM-generated code is flaky live | Fixed scoring library, strict output contract, one retry, labeled replay fallback. |
| Leaderboard submission has unknown mechanics | Check it in M0, not at 5 PM. |
| Credentials leak | `.env` and `.projects/vault/` are git-ignored by `stripe projects init`; verify before the first push; mask emails in the recording. |
| Spec claims exceed evidence | Label estimates and synthetic data; do not claim recovery-rate improvement. |

## 8. Manual steps only the account owner can do

These create accounts or authenticate in a browser and will not be done by the agent:

1. `npm install -g @stripe/cli`, then `stripe plugin install projects` (the npm package ships a `win32-x64` binary; Projects needs CLI v1.43.3+)
2. `stripe projects init recoverly` (browser sign-in to Stripe)
3. `stripe projects add createos/project` (creates the CreateOS account and writes credentials to `.env`)
4. `stripe projects env` to list the variable **names** written (never paste values anywhere)
5. `npm run spike:sandbox` to run the sandbox verification
6. Registration/approval on Luma and joining the Discord (outside this repo)

## 9. M0 findings (scaffold built, Oct 17)

### Resolved from the SDK's type definitions (v0.8.2), no sandbox spent

| Question | Answer |
| --- | --- |
| `runCommand` result shape | `{ result: { stdout, stderr, exit_code, error? }, exec_ms }`. A non-zero exit does **not** throw (`sandbox.sh()` is the throwing variant). |
| Execution timeout | SDK `timeoutMs` is only the HTTP request timeout (default 60 s). The real limit is GNU `timeout` inside the sandbox; the runner uses `timeout -k 2 N` and treats exit 124 as a timeout. |
| Egress | `createSandbox({ egress: [...] })` or `sandbox.setEgress([...])`, `host:port` rules. `[]`, `null` or `["*"]` mean allow-all. The runner locks egress with a single closed-loopback rule on every acquire; whether that fully blocks outbound traffic is verified by the spike, not assumed. |
| Errors | Typed classes incl. `CreateosSandboxPaymentRequiredError` (402, out of credit), `CreateosSandboxRateLimitError` (429), `CreateosSandboxPermissionError` (403 quota). Mapped to actionable messages in `describeSandboxError`. |
| Reuse | `createSandbox({ name })` names are unique per user; `listSandboxes()` + `resume()` let the runner reuse one sandbox instead of spending the 10-creates/day cap. |
| Module format | The SDK is **ESM-only**, so the project sets `"type": "module"`. |

### Still unverified (needs your credentials)

- Exact `.env` variable names written by `stripe projects add createos/project` (docs omit them; the SDK expects `CREATEOS_SANDBOX_API_KEY`).
- Whether the egress-lock rule really blocks outbound traffic, whether `pandas` is in `devbox:1`, and the timeout behavior. `npm run spike:sandbox` checks all of these in a single sandbox create.
- Leaderboard submission mechanics.

### Deploy risk on Windows (new)

The CreateOS CLI documents **macOS and Linux only**; the machine is Windows 11 with no Go and only WSL's internal `docker-desktop` distro. The app itself does not need the CLI (it uses the SDK + API key). Only `createos deploy` / `createos login` do. Fallback ladder, cheapest first:

1. Try building the CLI from source with Go (`winget install GoLang.Go`, then follow the repo's build step). Unconfirmed on Windows.
2. Install Ubuntu in WSL (`wsl --install -d Ubuntu`) and run the documented install script there.
3. Push to GitHub (required for submission anyway) and deploy the repo as a VCS project from the CreateOS dashboard. `createos deploy` is documented to support VCS projects deploying from the latest commit.

Decide by **1:00 PM PT** so deployment is not discovered broken at 4 PM.

### Secrets and the OneDrive folder

The project lives under `OneDrive\Desktop`, so `.env` (real credentials) and `node_modules`/`.next` will sync to the cloud. `.env` is git-ignored but OneDrive does not honor `.gitignore`. Safer: move the project to a non-synced path (e.g. `C:\dev\recoverly`) **before** running `stripe projects init`.
