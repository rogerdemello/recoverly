# Build Tasks

The ordered work list for the hackathon build window. Each task cites the document that defines "done". Times are Pacific (IST in parentheses); the window is **12:30 PM to 5:30 PM PT** (1:00 AM to 6:00 AM IST on Oct 18), and **nothing counts after the 5:30 PM PT lock**.

Read first: [AGENTS.md](../AGENTS.md). Authority order when documents disagree: this list's gates, then [technical-spec.md](technical-spec.md), then [ui-and-drafting-spec.md](ui-and-drafting-spec.md), then the [product spec](failed-payment-recovery-agent.md).

> **Deadline discrepancy (unresolved).** The event guide says submissions lock at **5:30 PM PT**, with demos from 6:00 PM. The organizers' Oct 17 reminder email says "submit your project by **6:00 PM PT**". Until an organizer confirms the real time in Discord, **work to 5:30 PM PT and submit by 5:15 PM PT**: the earlier time costs nothing if it is wrong, the later one could cost the submission.

Legend: **[USER]** = only the account owner can do it (browser sign-in, account creation, payment, posting). The coding agent must stop and ask for these, never attempt them.

## Rules for the whole build

- Do not start before 12:30 PM PT. The first commit is made after kickoff.
- Commit small and often so the public history shows the build happening during the window. Never commit `.env`, `.projects/vault/`, or credentials.
- Do not add anything on the "Out of scope" list (§Scope guard).
- Prefer cutting a feature to breaking a gate. The cut order is at the bottom.

## M0: Foundation and spikes (12:30 to 1:00 PM PT; 1:00 to 1:30 AM IST)

- [ ] **T0.1** Start the repo working tree. The user may restore the pre-kickoff scaffold parked in `C:\dev\recoverly-prep` (see its `PREP-NOTES.txt`) or have it rebuilt from scratch; this is their eligibility call. Either way the result must satisfy technical-spec §1 (layout, `"type": "module"`).
- [ ] **T0.2-pre (do first, after 12:30 PM PT)** `stripe projects init` scaffolds its **own `AGENTS.md`, `CLAUDE.md`, `.agents/skills/`, `.projects/` and `.env`** (per the participant guide), and the repo already has an `AGENTS.md` and a `.env` with the CreateOS key. So: (1) make the **first commit of the docs** so `git diff AGENTS.md` can reveal an overwrite and `git checkout AGENTS.md` can undo it; (2) copy `.env` to `C:\dev\recoverly-prep\.env.bak` (outside the repo); (3) after init, check `git diff AGENTS.md` and `.env` names (`stripe projects env`). If Stripe's version replaced ours, restore ours and append anything useful from theirs. Stripe's generated skill files under `.agents/skills/` are fine to keep and commit.
- [ ] **T0.2 [USER]** `stripe projects init recoverly`, then `stripe projects add createos/project`, then `stripe projects env` (names only). Record the variable **names** in `.env.example` and fix technical-spec §1/§11 item 1. The organizers' email also suggests signing up at `createos.sh/app` for Sandbox credits. If you do that first, use the **same email as your Stripe account** and then run `stripe projects link createos` (documented: associates an existing provider account) instead of letting `add createos/project` create a second account, so the project stays on the Stripe Projects path the rules require. Ask in the 12:15 PM PT CreateOS walkthrough if unsure.
- [ ] **T0.3** Run the sandbox verification (`npm run spike:sandbox`, or the equivalent integration test from technical-spec §10). Gate: python runs, `timeout` exists, non-zero exit is surfaced, timeout is enforced, egress is blocked, a second acquire reuses the same sandbox. Record any deviation in implementation-plan §9 and adjust technical-spec §6.
- [ ] **T0.4 [USER]** Provision the LLM provider (default: `stripe projects catalog openrouter`, then add it). Verify one real completion; pick the model slug; confirm JSON-mode support (technical-spec §11 items 1 and 2).
- [ ] **T0.5** Deploy a hello-world (`/api/health`) by **1:00 PM PT** using the path chosen in implementation-plan §9 (CLI build on Windows, WSL, or GitHub-linked deploy). Gate: a public URL returns `{ ok: true }`. Record the working path in the README.
- [x] **T0.6** Leaderboard mechanics are now known (from the participant guide, step 8; recorded in [launch-kit.md §4](launch-kit.md)): `stripe whoami`, `stripe projects share`, then "Submit Your Project" on the leaderboard with the share link, **public repo URL** and **deployed URL**, plus the case-sensitive hackathon code `CreateOS-2026`. Consequence: the deploy and a public repo must exist **before** submitting to the leaderboard. **[USER]** Run `stripe whoami` and `stripe projects share` once after the first service is added (T0.2) to confirm they work, rather than discovering a problem at 5 PM.
- [ ] **T0.7** First commit. Verify `git status` shows no `.env*` and `.gitignore` covers `.env`, `.env.*`, `.projects/vault/`, `.projects/cache/`, `node_modules`, `.next`, `.recoverly/`.

**Gate M0:** health URL is live, spike passes, LLM call works, env names recorded.

## M1: Data and deterministic core (1:00 to 1:45 PM PT; 1:30 to 2:15 AM IST)

- [ ] **T1.1** Save the CSV from [fixture-spec.md §2](fixture-spec.md) to `data/fixtures/failed_payments.csv`.
- [ ] **T1.2** CSV parser, validation, masking (technical-spec §2). Tests: every case in [fixture-spec §7](fixture-spec.md) plus masking.
- [ ] **T1.3** `sandbox/recoverly_lib.py` per technical-spec §3 and §5.3 (standard library only; rounding rule in §3.2).
- [ ] **T1.4** Golden tests: run the library on the fixture and compare with [Golden A and B](fixture-spec.md) using the stated tolerances. Python 3.12 is **not installed on the development machine** (only the Microsoft Store stub exists): install it, or run this test through the sandbox.
- [ ] **T1.5** `zod` schema for `AnalysisResult` and the extra checks, including plan conformance (technical-spec §4.1). Tests for each rejection.

**Gate M1:** Golden A and B pass; invalid-CSV tests pass.

## M2: Agent loop, no UI (1:45 to 3:00 PM PT; 2:15 to 3:30 AM IST)

- [ ] **T2.1** LLM client, planner, plan validation (technical-spec §5.2, §5.7; [agent-prompts §1](agent-prompts.md)). Tests: stubbed, plus a single real run over the eight few-shot questions.
- [ ] **T2.2** Code generator, fenced-block extraction, static guard (technical-spec §5.4; [agent-prompts §2](agent-prompts.md)). Tests for every guard rule.
- [ ] **T2.3** Sandbox runner (technical-spec §6) with an opt-in integration test.
- [ ] **T2.4** Pipeline, SSE route `POST /api/analyze`, retry, error codes (technical-spec §5, §7, §8). Capture the first script that passes Golden B as `sandbox/replay/rank_recoverable.py`.
- [ ] **T2.5** `GET /api/health` and `POST /api/data/load` (fixture and upload).
- [ ] **T2.6** `scripts/smoke.sh`: load fixture, run the demo question through the real LLM and sandbox, check Golden B headline values.

**Gate M2:** demo question returns Golden B via real LLM + real sandbox, 3 runs out of 3. If this gate is not met by **3:15 PM PT**, switch the demo to replay mode, label it honestly, and continue to M3.

Stretch only if M2 closes before 3:00 PM PT: Journey D (needs a second snapshot fixture and a fourth planner intent).

## M3: Dashboard (3:00 to 3:50 PM PT; 3:30 to 4:20 AM IST)

Implement [ui-and-drafting-spec §2](ui-and-drafting-spec.md):

- [ ] **T3.1** Header, data source, integration chips, CSV error table (§2.1).
- [ ] **T3.2** Ask panel with example chips and replay checkbox (§2.2); SSE-driven stepper and plan card (§2.3, §2.4).
- [ ] **T3.3** Code panel and run log (§2.5).
- [ ] **T3.4** Warnings, per-currency tiles, breakdown tables, per-currency queues, resolved list (§2.6).
- [ ] **T3.5** Detail drawer with score bars, fact/inference badges and uncertainty (§2.7).

**Gate M3:** the demo question can be run from a clean browser tab end to end without touching the console.

## M4: Draft and approval (3:50 to 4:15 PM PT; 4:20 to 4:45 AM IST)

Implement [ui-and-drafting-spec §3 and §4](ui-and-drafting-spec.md):

- [ ] **T4.1** Content checks and templates, with the "all templates pass all checks for all eligible rows" test.
- [ ] **T4.2** `POST /api/draft` (LLM + one regeneration + template fallback).
- [ ] **T4.3** `POST /api/draft/:id/approve`, nonce handling, audit log, `GET /api/audit`.
- [ ] **T4.4** Draft modal and audit drawer.

**Gate M4:** draft for `in_synth_001` shows the exact message, the checks, and the "will not be sent" approval; the audit entry exists with no message body.

## Feature freeze: 4:15 PM PT (4:45 AM IST)

Everything after this is hardening, documentation, recording and submission. No new features.

## Final: 4:15 to 5:20 PM PT (4:45 to 5:50 AM IST)

- [ ] **T5.1** Final deploy; run `scripts/smoke.sh` against the public URL. If `RECOVERLY_ACCESS_CODE` is used, include the code in the submission notes.
- [ ] **T5.2** Visible-failure pass (each must show the specified message, none may look like success): invalid CSV; bad sandbox key; stubbed malformed output; stubbed infinite loop (timeout); unsupported question; bad approval nonce.
- [ ] **T5.3** Replace `README.md` using [launch-kit.md §1](launch-kit.md); keep the old event README content in `docs/` if wanted. Commit.
- [ ] **T5.4 [USER]** Record the 2 to 3 minute demo with a team member on camera, following [launch-kit.md §2](launch-kit.md). Upload to YouTube (unlisted or public; judges must be able to open it).
- [ ] **T5.5 [USER]** Publish the X or LinkedIn post ([launch-kit.md §3](launch-kit.md)); it must tag `@createosai` on X or mention CreateOS on LinkedIn.
- [ ] **T5.6 [USER]** Leaderboard (needs the deployed URL and the public repo): `stripe whoami`, `stripe projects share`, then "Submit Your Project" at projects.dev/leaderboard with share link + repo + deployed URL + hackathon code `CreateOS-2026` (case-sensitive). Details in launch-kit §4.
- [ ] **T5.7 [USER]** Make the GitHub repository public; confirm no secrets in history (`git log -p` search for key prefixes) and no real customer data.
- [ ] **T5.8 [USER]** Submit the form with video, repo, post and leaderboard links. **Target 5:15 PM PT; the lock is 5:30 PM PT.** Walk through [submission-checklist.md](submission-checklist.md).
- [ ] **T5.9** After submitting, make **no further commits** (they do not count and risk confusion).

## Scope guard (do not build)

From the product spec §6: live-mode charging, automatic cancel/pause/retry, storing card or bank data, sending messages without approval, ML training, a CRM or email platform, guaranteed recovery prediction, replacing Stripe Smart Retries. Also not in the MVP: authentication/user accounts, a database, webhooks, a Stripe live-read adapter, a delivery adapter.

## Cut order if behind

1. Journey D / second snapshot.
2. Stripe test-mode seed and read adapter.
3. Upload CSV (fixture only).
4. Detail drawer polish (keep score bars and evidence).
5. Tone options (keep one tone).
6. Audit drawer (keep the server-side log).

**Never cut:** visible generated code, sandbox execution, plan conformance check, the approval step, deployment, the demo, the README.
