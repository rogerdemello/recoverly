# Recoverly: Failed Payment Recovery Agent

## 1. Executive summary

**Recoverly** is an AI agent for small subscription businesses that lose revenue when recurring payments fail. It turns a failed-payment export or Stripe test-mode data into a prioritized recovery queue.

For each failed payment, Recoverly:

1. Determines whether the payment appears recoverable.
2. Explains the likely cause in plain language.
3. Estimates the revenue at risk.
4. Recommends the safest next action.
5. Generates a customer-ready recovery message.
6. Writes and runs an analysis program inside a CreateOS Sandbox.

The agent is intentionally designed as a decision-support and communication tool for the hackathon MVP. It does not silently retry charges, change subscriptions, or send customer messages without confirmation.

## 2. Why this problem matters

Failed recurring payments create involuntary churn: the customer did not intentionally cancel, but the business can still lose the subscription. Common causes include expired cards, insufficient funds, generic declines, authentication requirements, and payment-method problems.

Stripe already provides important recovery primitives:

- Smart Retries can automatically retry failed subscription and invoice payments.
- Customer emails can notify customers about failed payments and provide a route to update their payment method.
- Stripe-hosted pages can let a customer update payment details and pay outstanding invoices.
- Revenue Recovery analytics reports failed payments, recovered payments, failure rate, recovery rate, decline reasons, and customers currently in recovery.

Recoverly complements these primitives by answering the operational question a small business owner still has:

> “Which failed payments should I focus on first, why, and what should I do next?”

## 3. Target user

### Primary user

The owner, operator, or engineer of a small subscription business that has:

- Recurring customers.
- A Stripe account.
- Failed payments that require triage.
- No dedicated revenue-operations analyst.

### Example users

- A small SaaS founder reviewing monthly billing failures.
- A membership business prioritizing high-value accounts.
- An online service with a few hundred subscriptions.
- A developer testing recovery workflows in Stripe test mode.

### User need

The user needs a fast, explainable answer—not an opaque “AI score”—that helps them recover revenue without exposing payment credentials or accidentally charging the wrong customer.

## 4. Product promise

> Recoverly converts failed-payment data into an explainable, prioritized recovery plan in under a minute.

The product should make three things obvious:

1. **What failed?**
2. **What revenue is at risk?**
3. **What is the safest next action?**

## 5. Hackathon fit

The hackathon brief requires an AI agent that writes and runs its own code inside a CreateOS Sandbox and uses Stripe Projects.

Recoverly demonstrates that requirement directly:

1. The user asks a natural-language question.
2. The agent translates the request into an analysis plan.
3. The agent writes a short, task-specific analysis script.
4. The script runs inside a CreateOS Sandbox.
5. The agent interprets the result and presents a recovery queue.
6. The user approves a message or action before it is sent or executed.

Stripe is not merely used for authentication or branding. Stripe payment and billing data is the core input, and the output can point to Stripe-hosted recovery pages or other Stripe-supported recovery actions.

## 6. Recommended MVP scope

### In scope

- Stripe test-mode data and/or a CSV import with synthetic failed-payment records.
- Natural-language analysis requests.
- Failed-payment classification.
- Revenue-at-risk calculation.
- Customer prioritization.
- Recovery recommendation generation.
- Customer message drafting.
- A review screen requiring explicit approval.
- Visible generated-code execution in the CreateOS Sandbox.
- A simple dashboard showing summary metrics and the recovery queue.
- Deployment through the hackathon’s Stripe Projects/CreateOS workflow.

### Out of scope for the hackathon MVP

- Automatic live-mode charging.
- Automatic subscription cancellation or pausing.
- Storing card numbers, CVCs, bank details, or other payment credentials.
- Sending messages without user approval.
- Machine-learning model training.
- A full CRM, email provider, or customer-support platform.
- Guaranteed prediction of whether a payment will recover.
- Replacing Stripe Smart Retries or Stripe’s built-in customer emails.

Keeping these boundaries makes the product safer and achievable in a single build session.

## 7. Core user journeys

### Journey A: Analyze current failures

1. The user opens Recoverly.
2. The user selects Stripe test data or uploads a CSV.
3. The user asks: “Show me the failed payments most worth recovering.”
4. The agent explains the planned analysis.
5. The agent writes and runs the analysis code in the sandbox.
6. Recoverly displays total failed amount, number of affected customers, recovery status, and a ranked queue.

### Journey B: Investigate one customer

1. The user selects a failed payment.
2. Recoverly shows the amount, customer tenure, subscription context, failure reason, retry state, and last attempt.
3. The agent explains what is known and what is uncertain.
4. The agent recommends a next step such as “send payment-method update link” or “wait for the configured retry.”

### Journey C: Draft a recovery message

1. The user selects a queue item.
2. The user chooses a tone: concise, friendly, or professional.
3. The agent writes a message using only approved customer and invoice fields.
4. The user reviews and approves the draft.
5. The system records the approval and either displays the final message or calls the configured delivery integration.

### Journey D: Re-run after recovery

1. The user asks: “What changed since yesterday?”
2. The agent generates a comparison script.
3. The sandbox computes recovered, still-in-recovery, and not-recovered groups.
4. Recoverly presents the change and estimated recovered amount.

## 8. Functional requirements

### FR-1: Data ingestion

The product must support one reliable demo input:

- Stripe test-mode records, or
- A documented CSV fixture with synthetic data.

The CSV fallback must use Stripe-like identifiers and clearly indicate that it contains synthetic data. It must not contain real card data.

Suggested fields:

| Field | Purpose |
| --- | --- |
| `customer_id` | Stable customer reference |
| `customer_email` | Message destination or masked display |
| `invoice_id` | Invoice reference |
| `subscription_id` | Subscription reference |
| `amount_due` | Amount at risk in minor currency units |
| `currency` | Currency code |
| `failure_code` | Machine-readable decline or failure code |
| `failure_message` | Provider-facing failure description, if available |
| `failed_at` | Time of failed attempt |
| `attempt_count` | Number of attempts |
| `next_payment_attempt` | Scheduled retry, if available |
| `invoice_status` | Open, paid, uncollectible, or void |
| `customer_created_at` | Customer tenure calculation |

### FR-2: Natural-language requests

The agent should support questions such as:

- “Which failed payments represent the most recoverable revenue?”
- “Show customers with payments over $100 that failed in the last seven days.”
- “What are the top failure reasons?”
- “Which customers are still in recovery?”
- “Draft a message for the three highest-priority customers.”
- “What recovered since yesterday?”

### FR-3: Analysis

The agent must calculate or derive:

- Number of failed payment attempts.
- Number of affected customers.
- Total amount at risk.
- Failure rate when a denominator is available.
- Recovery rate when historical outcome data is available.
- Amount and count by failure reason.
- Amount and count by recovery status.
- Top customers in recovery.
- Customer tenure or other explainable context.

### FR-4: Prioritization

Every queue item must include:

- Priority: urgent, high, medium, or low.
- A numeric score or ordered rank.
- The reason for its position.
- Estimated amount at risk.
- Recommended next step.
- Confidence or data-quality note.

The score is a triage heuristic, not a promise of recovery.

### FR-5: Recommendations

Recommendations should be conservative and based on available evidence:

- **Update payment method:** likely payment-method issue and a customer action is needed.
- **Wait for retry:** Stripe retry is scheduled and no immediate intervention is necessary.
- **Review manually:** high-value or ambiguous account requiring human judgment.
- **Contact customer:** repeated failure or high amount, with an approved draft.
- **Do not pursue:** invoice is paid, void, canceled, or otherwise no longer collectible.

### FR-6: Message drafting

Drafts must:

- Identify the billing issue without exposing sensitive payment details.
- State the amount and invoice context only when appropriate.
- Provide a secure Stripe-hosted update or payment route when available.
- Avoid claiming that a charge will succeed.
- Avoid threatening language.
- Include a support contact or business-provided next step.

### FR-7: Human approval

The product must require explicit approval before:

- Sending a message.
- Retrying a payment outside the normal configured process.
- Changing a subscription.
- Marking an invoice uncollectible or paid out of band.

The MVP can stop at a reviewed draft if delivery integration would add risk.

### FR-8: Explainability

The UI must show the inputs used for a recommendation. A user should be able to answer:

- Which fields affected the priority?
- Which failure reason was observed?
- Is a retry scheduled?
- Is this a Stripe fact or an agent inference?

## 9. Prioritization model

Use a transparent heuristic for the MVP. Do not describe it as a predictive model.

### Suggested score

```text
priority_score =
  normalized_amount_at_risk * 0.45
  + recovery_signal * 0.25
  + urgency_signal * 0.20
  + customer_value_signal * 0.10
```

Where:

- **Amount at risk:** invoice amount normalized within the current dataset.
- **Recovery signal:** higher when the failure reason appears recoverable or a payment-method update is possible.
- **Urgency signal:** higher when the invoice is close to subscription cancellation, overdue, or has no retry scheduled.
- **Customer value signal:** customer tenure, historical paid volume, or subscription value when available.

If a field is missing, the score must identify the missing input and reduce confidence rather than silently inventing a value.

### Important distinction

“Highest amount” is not the same as “most likely to recover.” The UI should show both:

- **Amount at risk**
- **Recovery priority**

## 10. Stripe workflow and data model

### Relevant Stripe concepts

- **Customer:** owns billing identity and payment relationship.
- **Subscription:** recurring service relationship.
- **Invoice:** amount due for a billing period.
- **PaymentIntent:** tracks a payment attempt and its lifecycle.
- **PaymentMethod:** the payment instrument reference; Recoverly must never store raw card data.
- **Webhook event:** notification that allows the application to react to Stripe activity.

### Relevant events

The integration may use events such as:

- `invoice.payment_failed`
- `invoice.paid`
- `payment_intent.payment_failed`
- `payment_intent.succeeded`
- Subscription status changes relevant to recovery

The exact event selection should be confirmed against the Stripe account’s billing flow. Invoice-level events are important for recurring billing context; PaymentIntent events provide payment-attempt lifecycle detail.

### Recovery states

Recoverly should normalize records into these application states:

| State | Meaning |
| --- | --- |
| `failed` | Latest known payment attempt failed |
| `in_recovery` | Stripe or the business may still retry or intervene |
| `action_needed` | Customer or operator action is recommended |
| `recovered` | Payment later succeeded |
| `not_recovered` | Recovery window ended or invoice is no longer collectible |
| `unknown` | Required data is missing or inconsistent |

### Stripe-native actions

Recoverly should prefer Stripe-supported recovery mechanisms:

- Let Stripe Smart Retries handle configured automatic retry behavior.
- Use Stripe customer email settings where they meet the business need.
- Link to Stripe-hosted customer/payment-method update pages when available.
- Use a payment link or hosted invoice URL only when the business flow supports it.
- Request a manual invoice payment attempt only as an explicit, reviewed action.

## 11. Agent architecture

### Logical components

1. **Chat/request interface**
   - Accepts a natural-language request.
   - Shows progress and generated analysis.

2. **Agent planner**
   - Converts the request into a typed analysis plan.
   - Selects allowed fields and calculations.
   - Explains the intended action before execution.

3. **Data adapter**
   - Reads Stripe test-mode data or the CSV fixture.
   - Normalizes amounts, currencies, timestamps, and statuses.

4. **Code generator**
   - Produces a short, reviewable analysis program.
   - Uses a constrained template or allowlisted operations where possible.

5. **CreateOS Sandbox runner**
   - Executes generated code in an isolated sandbox.
   - Returns structured output, stdout, stderr, and execution status.

6. **Result interpreter**
   - Validates the output schema.
   - Converts results into metrics, queue items, and explanations.

7. **Action guard**
   - Blocks unapproved side effects.
   - Requires confirmation for communication or payment actions.

8. **Dashboard**
   - Shows metrics, queue, detail view, generated code, and execution result.

### Execution contract

The generated program should return structured JSON rather than unbounded prose. At minimum:

- `summary`
- `metrics`
- `ranked_items`
- `warnings`
- `data_quality`

The application must reject malformed or incomplete output explicitly and show an error to the user.

## 12. CreateOS Sandbox design

CreateOS describes its Sandbox as an environment for untrusted and AI-generated workloads, using Firecracker microVMs with isolated kernels and configurable egress controls. Its quickstart documents creating a sandbox, executing a command, running a reconnectable process, and destroying the sandbox.

For Recoverly:

- Create a short-lived sandbox per analysis or reuse a controlled session.
- Pass only the minimum normalized dataset needed for the analysis.
- Do not place Stripe secret keys in generated code or user-visible output.
- Prefer no network access for pure CSV analysis.
- If Stripe API access is required, use a narrow server-side adapter and restricted credentials outside generated code.
- Capture execution status and logs for the demo.
- Destroy temporary sandboxes when the job completes unless a session is intentionally retained.

## 13. CreateOS MCP integration

The CreateOS MCP documentation describes capabilities for managing, deploying, and retriggering projects; analyzing deployment logs and request statistics; managing GitHub repositories; and automating deployments.

Use MCP for operational tasks, not for unrestricted customer actions:

- Inspect deployment status.
- Read deployment logs when a release fails.
- Retrigger a deployment after a reviewed fix.
- Inspect request statistics during the demo.
- Manage the repository or deployment workflow.

The core payment analysis should remain a controlled application workflow. MCP should not be given authority to send payments or change billing state without a separate, explicit approval path.

## 14. Stripe Projects role

Stripe Projects is the project provisioning and credential-management layer for the hackathon. It can provision and manage third-party services such as hosting, databases, authentication, AI, and observability from the terminal, and sync credentials into the project environment.

Recoverly should use Stripe Projects to demonstrate:

- Project setup from the terminal.
- Required service provisioning.
- Environment and credential synchronization.
- A deployed, working application.

The demo should visibly distinguish:

- Stripe Projects: project/service setup and environment management.
- CreateOS Sandbox: isolated execution of generated analysis code.
- Recoverly: business workflow and user experience.

## 15. Security and privacy requirements

### Data minimization

Only collect fields needed for triage and messaging. Mask or omit customer email addresses in screenshots and recorded demos unless synthetic.

### Secret handling

- Never expose Stripe secret keys to the language model or generated code.
- Never commit credentials to the repository.
- Store secrets in the project’s environment/secret-management mechanism.
- Use test mode for the hackathon demo.

### Payment data

- Never collect or store PAN, CVC, full bank-account details, or card security data.
- Store Stripe object IDs and non-sensitive metadata only.
- Use Stripe-hosted pages for payment-method updates.

### Side-effect controls

The agent must default to read-only analysis. Any write operation must:

1. Describe the proposed action.
2. Show the target customer/invoice.
3. Show the exact message or operation.
4. Require explicit approval.
5. Record the decision and result.

### Prompt and code safety

- Treat imported data as untrusted input.
- Do not execute code embedded in CSV fields.
- Limit generated code to an allowlisted runtime and libraries.
- Validate generated output against a schema.
- Enforce time, memory, file, and network limits in the sandbox.
- Do not allow generated code to access arbitrary credentials or host files.

## 16. Failure handling

The application must fail visibly and safely:

| Failure | Required behavior |
| --- | --- |
| Stripe API unavailable | Show an integration error; offer CSV demo mode if configured |
| Invalid CSV | Identify missing/invalid columns and reject the import |
| Sandbox execution failure | Show execution status and error; do not produce a success-shaped result |
| Malformed agent output | Reject it and ask for a regenerated structured result |
| Missing retry information | Mark confidence lower; do not assume no retry exists |
| Currency mismatch | Group by currency or require normalization; never sum incompatible amounts |
| Duplicate webhook/event | Deduplicate by event ID or normalized business key |
| Customer already paid | Remove from action queue and show the updated state |
| Send-action failure | Report failure and preserve the approved draft for retry |

## 17. Success metrics

### Product metrics

- Time from data import to first recovery queue.
- Percentage of records with an explainable recommendation.
- Percentage of recommendations with all required source fields.
- Number and amount of recovered payments.
- Recovery rate, when a complete denominator and recovery window exist.
- Amount of revenue in the top five recommended actions.

### Demo metrics

The demo should visibly show:

- A natural-language request.
- Generated code.
- Sandbox execution.
- Structured results.
- A prioritized queue.
- A human-approved recovery message.
- A deployed application.

Do not claim an actual recovery-rate improvement from a short demo dataset. Demonstrate the measurement framework instead.

## 18. Demo dataset

Use synthetic Stripe-like records covering distinct cases:

1. High-value payment with an expired card.
2. Medium-value payment with insufficient funds and a scheduled retry.
3. Low-value generic decline.
4. Payment that later succeeds.
5. Invoice that is no longer collectible.
6. Customer with multiple failed attempts.
7. Customer with an authentication-required failure.
8. A record with missing optional data to demonstrate confidence handling.

The dataset should contain enough variation to make ranking meaningful, but remain small enough that the generated code and result can be shown during a two- to three-minute demo.

## 19. Two- to three-minute demo script

### Opening: 20 seconds

“Failed payments create involuntary churn. Recoverly tells a small business which customers to contact first and why.”

### Input and plan: 25 seconds

Ask:

> “Find the failed payments from the last seven days with the highest recoverable revenue. Explain the reason and recommend the next safe action.”

Show the agent’s plan and the fields it will use.

### Code execution: 35 seconds

Show the generated analysis program and execute it in the CreateOS Sandbox. Show the execution status and structured result.

### Result: 45 seconds

Show:

- Total amount at risk.
- Customers affected.
- Failure reasons.
- Recovery status.
- Top three prioritized customers.

Open one customer and explain why it was ranked first.

### Safe action: 30 seconds

Generate a concise recovery message with a Stripe-hosted update/payment route. Show the approval step; do not silently send it.

### Platform proof and close: 25 seconds

Briefly show:

- Stripe Projects provisioning/configuration.
- CreateOS Sandbox execution.
- Deployment status or logs through CreateOS tooling.

Close with:

“Recoverly does not replace Stripe’s retries or emails. It gives small businesses an explainable operator layer for deciding what to do next.”

## 20. Build plan

### Phase 1: Foundation

- Create the Stripe Projects application.
- Confirm test-mode access.
- Establish the CreateOS Sandbox workflow.
- Prepare the synthetic fixture.

### Phase 2: Analysis

- Normalize payment records.
- Implement the transparent prioritization specification.
- Define the structured analysis output.
- Add data-quality warnings.

### Phase 3: Agent experience

- Add natural-language request handling.
- Display the plan and generated code.
- Execute the code in the sandbox.
- Render the metrics and recovery queue.

### Phase 4: Safe action

- Add message drafting.
- Add review and approval.
- Add Stripe-hosted recovery destination where available.
- Keep external sending optional and disabled by default.

### Phase 5: Deployment and demo hardening

- Deploy through Stripe Projects/CreateOS.
- Test failure states.
- Remove secrets and real customer data.
- Record the demo.
- Verify the public repository README and submission links.

## 21. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Spending the day on a live Stripe integration | Start with synthetic/test-mode data and add live reads only if stable |
| Agent generates unsafe code | Constrain runtime, sandbox execution, network, and output schema |
| Ranking looks arbitrary | Show the transparent score factors and source fields |
| Stripe integration becomes incidental | Make Stripe billing objects and recovery links central to the workflow |
| Demo takes too long | Use a small fixed dataset and one polished user journey |
| Accidental customer communication | Require explicit approval and default to draft-only mode |
| Claims exceed evidence | Label estimates, confidence, and synthetic/demo data clearly |

## 22. Definition of done

Recoverly is ready for submission when:

- A user can load the documented demo dataset.
- A natural-language request produces a visible analysis plan.
- The agent writes and runs analysis code in a CreateOS Sandbox.
- The output contains validated metrics and a ranked queue.
- Each queue item explains its priority and recommended action.
- A recovery message can be drafted and reviewed.
- No payment or message side effect happens without approval.
- The app is deployed using the required project workflow.
- The public repository contains a clear README.
- The demo video is two to three minutes and includes a team member on camera.

## 23. Research sources

The following official sources informed this specification:

- [CreateOS hackathon brief](https://createos.sh/hackathon)
- [Hackathon Luma event page](https://luma.com/6stm74wk?tk=SQ8LHB)
- [CreateOS Sandbox overview](https://createos.sh/docs/Sandbox/)
- [CreateOS Sandbox quickstart](https://createos.sh/docs/Sandbox/Quickstart/)
- [CreateOS Sandbox limits and defaults](https://createos.sh/docs/Sandbox/Limits/)
- [CreateOS MCP documentation](https://createos.sh/docs/API-MCP/CreateOS-MCP/)
- [Stripe Projects CLI](https://docs.stripe.com/projects)
- [Stripe revenue recovery](https://docs.stripe.com/billing/revenue-recovery)
- [Stripe Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
- [Stripe customer emails](https://docs.stripe.com/billing/revenue-recovery/customer-emails)
- [Stripe revenue recovery analytics](https://docs.stripe.com/billing/revenue-recovery/recovery-analytics)
- [Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Stripe PaymentIntents API](https://docs.stripe.com/api/payment_intents)
- [Stripe Pay an invoice API](https://docs.stripe.com/api/invoices/pay)

This document distinguishes documented platform capabilities from Recoverly’s proposed product behavior. Stripe API behavior and CreateOS limits should be rechecked immediately before implementation because both products evolve.

