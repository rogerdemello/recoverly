# Recoverly: Demo Video Plan (target about 2:40, hard limits 2:00 to 3:00)

Hackathon rules for the video: hosted on YouTube, 2 to 3 minutes, **at least one team member visible on camera**, and it must show the working agent. Say that all data is synthetic.

## 1. The project in simple words

Small subscription businesses lose money every month when customers' card payments fail: expired cards, empty accounts, bank declines. The owner gets a long list of failed payments and has no clear idea which ones to chase first, or what to say.

**Recoverly** reads that list and turns it into a ranked to-do list. For every failed payment it tells you:

- **What went wrong** (for example, the card expired).
- **How much money is at risk.**
- **The safest next step** (for example, send the customer the secure Stripe payment page, or just wait for Stripe's automatic retry).
- **A ready-written message** to the customer, which a human must approve before anything happens.

You ask in plain English, like "Which failed payments from the last week are worth the most?" Recoverly's AI agent does not guess the answer. It **writes a short Python program, runs it inside an isolated CreateOS Sandbox, and checks the result** before showing it. The AI never sees customer names or emails; the numbers come from the code, not from the model.

**It never charges, retries, cancels or sends anything.** Approving a message only records the decision.

**One-line pitch:** "Recoverly turns a pile of failed payments into a clear, explainable recovery plan, using an agent that writes and runs its own code safely."

## 2. Before you record (checklist)

- [ ] App running (`npm run dev`) at http://localhost:3000, browser zoom around 110%, notifications off, tabs closed.
- [ ] `.env` filled in. Do one full dry run first so the sandbox is warm and you know the real timing.
- [ ] Have the **Replay saved script** checkbox ready as a fallback if the LLM is slow. If you use it, say so on screen or in the voice-over; the app also labels it.
- [ ] Do a fresh page load right before recording so the data and audit log are empty.
- [ ] Record your face for the intro and outro (or a small corner camera throughout).
- [ ] Keep the repo (`sandbox/recoverly_lib.py` and `src/lib/sandbox/runner.ts`) open in an editor tab in case you want a 5-second cutaway.

## 3. Demo script and timing

Speak at a relaxed pace, about 330 to 380 words in total. The right column is the voice-over, which you can read as written or paraphrase.

| Time | On screen | What you say |
| --- | --- | --- |
| **0:00 to 0:12** On camera | You, then cut to the Recoverly dashboard. | "Hi, I'm [name]. Every month, subscription businesses lose revenue to failed card payments, and nobody knows which ones to chase first. This is Recoverly." |
| **0:12 to 0:30** Problem and idea | The dashboard header. Hover over nothing yet. | "Recoverly takes a failed-payment export and turns it into a ranked recovery queue. You ask a question in plain English, and an agent writes and runs real code to answer it, inside a CreateOS Sandbox, so the result is checked, not guessed." |
| **0:30 to 0:42** Load data | Click **Load demo data**. Pause on the confirmation. | "I'll load a small demo file. All data here is synthetic. Emails are masked the moment they're imported, and the AI model never sees customer records." |
| **0:42 to 1:12** Ask and watch the agent | The question box is pre-filled with the first example. Click **Run analysis**. Let the pipeline stepper move through plan, code, guard, sandbox, validate. Open the generated code panel briefly. | "I ask: find last week's failed payments with the highest recoverable revenue, explain why, and recommend a safe action. First the agent shows its plan. Then it writes a short Python script. A safety check scans that script before it runs. Then it executes in the CreateOS Sandbox with the network turned off and a hard time limit. Finally the server verifies the output against the original data, so nothing invented can reach the screen." |
| **1:12 to 1:35** The result | Scroll over the summary, the tiles, then the ranked queue. | "Here is the queue, in about [N] seconds. Total money at risk, grouped by failure reason, and a ranked list. The top item is a $499 expired card. It ranks first because the amount is large and the customer is long-standing. Note that money is kept in exact units and is never added across currencies." |
| **1:35 to 2:00** Explainability | Click the top row to open the detail drawer. Point at the score bars, then "what we know vs infer", then "what is uncertain". | "Click any row and Recoverly explains itself. These bars show exactly how the priority score is built. This section separates facts that came from Stripe data from what the agent inferred, and this one says what is uncertain. The score is a triage heuristic, not a prediction, and the app says so." |
| **2:00 to 2:25** Draft and approve | Click **Draft message**. Show the content checks list going green. Click **Approve**. Show "approved, not sent". | "Next step: draft a message. It uses a safe template, and ten checks run on it: correct amount, the secure Stripe link, no threats, no internal data. A human has to approve it. When I do, the decision is recorded, but nothing is sent, because this version has no ability to charge or send anything." |
| **2:25 to 2:33** Audit and tech | Click **Audit log** to show the entry (hash and length only, no message text). | "Every approval lands in an audit log that stores a hash, never the message itself." |
| **2:33 to 2:45** On camera, wrap | You on camera, or the dashboard with your camera in the corner. | "Recoverly uses Stripe Projects to provision the project and credentials, and the CreateOS Sandbox to run every piece of agent-written code. Safe, explainable, human-approved. Thanks for watching." |

> The table ends at about 2:45, leaving room under the 3:00 limit. Rehearse once with a timer and cut words, not steps. If you run long, drop the Audit row first.

## 4. Short version of the flow (for a cue card)

1. Intro on camera: the problem in one sentence.
2. **Load demo data**.
3. **Run analysis** with the default question. Narrate: plan, code, guard, sandbox, validated.
4. Show the ranked queue and the totals.
5. Open the top row: score bars, know vs infer, uncertainty.
6. **Draft message**, show the checks, **Approve**: recorded, not sent.
7. **Audit log**.
8. Outro on camera: Stripe Projects plus CreateOS Sandbox.

## 5. Things to say, and not say

**Do say**

- The data is synthetic.
- The agent writes and runs code in the CreateOS Sandbox (egress locked, timeout, output verified).
- Stripe Projects provisioned the project and credentials.
- Nothing is sent or charged; a human approves every message.

**Do not say**

- Any recovery-rate improvement or "we recovered $X". The dataset is tiny and synthetic.
- That it connects to a live Stripe account. This version uses CSV import only.
- That the score predicts whether a customer will pay. It is a heuristic for triage.

## 6. If something goes wrong while recording

| Problem | Fix |
| --- | --- |
| LLM is slow or errors out | Tick **Replay saved script**, run again, and say "this replays the saved script so the demo is deterministic." |
| Sandbox is slow on first call | Do a warm-up run before recording and cut the wait in editing. |
| Page state is cluttered | Refresh the page; state is in memory and resets. |
| Over 3:00 | Drop the Audit log step and shorten the problem intro. |

## 7. After recording

- [ ] Length is between 2:00 and 3:00.
- [ ] A team member is visible on camera.
- [ ] Upload to YouTube and put the link in `README.md` (replace the "add the YouTube link here" line).
- [ ] Add the link to the submission form and the public X or LinkedIn post (tag `@createosai` on X, or mention CreateOS on LinkedIn).
