# Launch Kit: README, Demo, Posts, Submission

Drafts to finish in the last hour. Every `[PLACEHOLDER]` must be replaced; every claim must be true on the day. Do **not** claim a measured recovery-rate improvement (the demo dataset is synthetic and tiny), and say that the data is synthetic everywhere.

## 1. Final `README.md` template

Replaces the current event-oriented README at T5.3 in [build-tasks.md](build-tasks.md). The judges' checklist requires the README to explain what the project does and how to run or try it.

````markdown
# Recoverly

**Explainable failed-payment recovery for small subscription businesses.** Recoverly turns a failed-payment export into a prioritized recovery queue. For each failed payment it says what failed, how much revenue is at risk, and the safest next step, and it drafts a customer message that a human must approve. The analysis is performed by **code the agent writes at request time and runs inside a CreateOS Sandbox**.

Built for the CreateOS x Stripe "Build Agents That Run Code" hackathon (Oct 17, 2026).

- Demo video: [YOUTUBE_URL]
- Live app: [DEPLOYED_URL] [ACCESS_CODE_NOTE_IF_ANY]
- All data in this repository is **synthetic**.

## How it works

```text
question -> plan (LLM) -> code (LLM) -> static guard -> CreateOS Sandbox -> validated JSON -> ranked queue
                                                                 |
                              server re-checks the output against the plan; nothing unverified is shown
```

1. You ask a question in plain language ("Find the failed payments from the last seven days with the highest recoverable revenue").
2. The agent shows its plan, then writes a short Python script that applies the plan's filters and calls a fixed, tested scoring library.
3. The script runs in an isolated CreateOS Sandbox with network access locked and a hard timeout.
4. The server validates the output schema, checks that the script honored the plan, and only then renders the queue.
5. Each row explains its priority: the score breakdown, which facts came from Stripe-shaped data and which are agent inferences, and what is uncertain.
6. A drafted message goes through safety checks and needs explicit approval. **In this version nothing is ever sent or charged.**

## Where the hackathon technologies are used

| Technology | Use |
| --- | --- |
| **CreateOS Sandbox** | Runs every piece of agent-written analysis code (`src/lib/sandbox/runner.ts`) in an isolated microVM with locked egress |
| **Stripe Projects** | Project and service provisioning from the terminal (`stripe projects init`, `add createos/project`, [LLM_PROVIDER_ADD_COMMAND]) and credential sync into `.env` |
| **Stripe data model** | Input follows the Stripe Invoice / PaymentIntent decline-code model; recommendations favor Stripe-hosted recovery pages and leave retries to Stripe Smart Retries |

[Fill in or delete: any CreateOS MCP / deployment tooling actually used.]

## Safety model

- Read-only analysis; no payment, subscription, or messaging action exists in the API.
- The LLM never sees customer records; all figures come from validated sandbox output.
- Generated code is checked before it runs and its output is verified after.
- Customer emails are masked everywhere except an approved draft; audit entries store hashes, not message bodies.
- Declines whose real reason Stripe says not to disclose (lost, stolen, fraud) are shown to customers as generic.

## Run it

Prerequisites: Node.js 24+, a CreateOS account (via Stripe Projects), an LLM provider key.

```bash
npm install
cp .env.example .env     # fill in names listed there; never commit .env
npm run dev              # http://localhost:3000
npm test
```

Credentials: [DESCRIBE HOW ENV VARS ARE PROVISIONED WITH stripe projects].

Try it: click **Load demo data**, then run the first example question.

## Project structure

[PASTE the layout from docs/technical-spec.md §1, trimmed to what exists.]

## Limitations

- Synthetic demo data; no live Stripe account is read.
- The priority score is a transparent heuristic, not a prediction of recovery.
- Message delivery is intentionally not implemented.
- In-memory state: a server restart clears loaded datasets and drafts.
- [Add anything that is actually unfinished.]

## Documentation

Product spec, technical spec, fixture and golden results, prompts: see `docs/`.
````

## 2. Demo video (2 to 3 minutes, target 2:50)

A team member must be **visible on camera** (a face-cam overlay is enough). Rehearse once; record in one take if possible.

| Time | Segment | On screen | Say |
| --- | --- | --- | --- |
| 0:00 to 0:15 | Hook | Face cam, then the app | "Failed payments quietly churn subscribers. Recoverly tells a small business which customers to deal with first, and why." |
| 0:15 to 0:35 | Question and plan | Click **Load demo data**, click the first example chip, **Run analysis**. Plan card appears. | "I ask in plain language. Before any code runs, the agent shows its plan: last seven days, ranked by recoverability." |
| 0:35 to 1:10 | Agent writes and runs code | Code panel, then the run log | "The agent wrote this script, including the filter logic. A static check approves it, then it runs in a CreateOS Sandbox with network access locked. Here is the sandbox ID and run time. The server then re-verifies that the script did what the plan said." |
| 1:10 to 1:55 | Result and explanation | Tiles, USD queue, then open the drawer for the top row; then contrast the $320 row with the $79 row | "$1,362 at risk across nine customers. Number one is an expired card: high amount, easy to fix. Notice the $320 account ranks second but is sent to manual review: the biggest amount is not always the most recoverable. Every row shows which facts are Stripe data and which are the agent's inference. EUR is ranked separately; we never mix currencies." |
| 1:55 to 2:25 | Safe action | Draft message for the top row, the checks, the approval button | "I draft a message. It only uses approved fields, links to the Stripe-hosted invoice page, and passes safety checks. Nothing is sent without approval, and in this version nothing is sent at all. The decision is audited." |
| 2:25 to 2:50 | Platform proof and close | Terminal: `stripe projects status` (no secrets visible), then the deployed URL | "The project was provisioned with Stripe Projects, analysis runs in the CreateOS Sandbox, and this is the deployed app. Recoverly does not replace Stripe's retries or emails; it gives small businesses an explainable layer for deciding what to do next." |

The "$1,362" figure above is the 7-day USD at-risk total ($1,362.00 = 136200 minor units, [Golden B](fixture-spec.md)). If the dataset changes, recompute every number in this script.

Recording checklist:

- [ ] Resolution at least 1280x720; browser zoom so the table and the code are readable.
- [ ] No secrets on screen. Never run `cat .env`; `stripe projects env` prints names only, which is fine.
- [ ] Notifications off; terminal history cleared; only synthetic data visible.
- [ ] The data badge "Synthetic demo data" is visible at least once.
- [ ] Uploaded to YouTube **early** (processing takes time). Set to Public or Unlisted and confirm the link opens in a private window.
- [ ] YouTube shows a duration between 2:00 and 3:00.

YouTube title: `Recoverly: an AI agent that writes and runs its own code to recover failed payments (CreateOS x Stripe Projects)`

YouTube description:

```text
Recoverly turns failed subscription payments into an explainable, prioritized recovery queue. The agent writes its own analysis code and runs it in a CreateOS Sandbox; a human approves every customer message.

Built for the CreateOS x Stripe "Build Agents That Run Code" hackathon.
Code: [GITHUB_URL]
Live app: [DEPLOYED_URL]
All data shown is synthetic.
```

## 3. Public post

Requirement: publish on **X or LinkedIn**; on X tag `@createosai`, on LinkedIn mention CreateOS. Post only after the video is public and the repo is public so the links work.

**X (keep under 280 characters including links; each link counts as 23)**

```text
Recoverly: an agent that writes and runs its own code in a @createosai Sandbox to triage failed subscription payments. Explainable ranking, human-approved messages, nothing auto-sent. Built with Stripe Projects.
Demo: [YOUTUBE_URL]
Code: [GITHUB_URL]
```

(Measured at 271 characters with two 23-character links, so there is room for a short hashtag. Re-count if you edit it.)

**LinkedIn**

```text
I built Recoverly for the CreateOS x Stripe Projects hackathon: an AI agent that triages failed subscription payments.

Failed recurring payments quietly churn customers who never meant to leave. Stripe already retries and emails them. What a small business still needs is an answer to "which failed payments should I deal with first, and why?"

Recoverly writes a short analysis script for each question, runs it in a CreateOS Sandbox (isolated, network locked, hard timeout), verifies the output, and shows a ranked queue where every row explains its score and separates Stripe facts from the agent's inferences. Recovery messages are drafted but need explicit human approval; nothing is sent or charged automatically.

Everything shown uses synthetic data. Project setup used Stripe Projects.

Demo: [YOUTUBE_URL]
Code: [GITHUB_URL]
#CreateOS #StripeProjects
```

Before posting: links open while logged out; the post says the data is synthetic; no performance claims; the CreateOS mention is present.

## 4. Leaderboard

From the Stripe Projects participant guide (step 8). Do this **after** the app is deployed and the GitHub repo is public:

1. `stripe whoami` to get the Stripe account ID (required for the leaderboard).
2. `stripe projects share` to generate a share link. It encodes the project's service stack (not credentials) and needs at least one service added.
3. At `projects.dev/leaderboard` click **Submit Your Project** and paste the share link, the public repo URL and the deployed URL.
4. Enter the **Hackathon code** `CreateOS-2026` exactly as written (it is **case-sensitive**); it tags the project to this event.

Also share the project in the event Discord. The leaderboard page needs a Stripe Projects sign-in, so submit from your own browser. Record the final public entry URL here:

```text
[LEADERBOARD ENTRY URL]
```

The guide does not say whether the leaderboard records a project creation time, which remains a reason to run `stripe projects init` only after kickoff.

## 5. Submission form

Fields requested by the organizers (exact form labels unknown until opened): team and project details; demo video URL (YouTube); public GitHub URL; public X or LinkedIn post URL; leaderboard entry. Prepare the values in advance:

| Field | Value |
| --- | --- |
| Project name | Recoverly |
| One-line description | An AI agent that writes and runs its own analysis code in a CreateOS Sandbox to triage failed subscription payments, with human-approved recovery messages. |
| Team | [NAMES, at most three] |
| Video | [YOUTUBE_URL] |
| Repository | [GITHUB_URL] |
| Post | [POST_URL] |
| Leaderboard | [LEADERBOARD_URL] |
| Live app and access code (if used) | [DEPLOYED_URL] [CODE] |

Submit by **5:15 PM PT** (lock at 5:30 PM PT). Then follow [submission-checklist.md](submission-checklist.md).
