/** User-facing copy for warnings, errors, actions and missing inputs (ui-and-drafting-spec section 2). */
import type { Action } from "../domain/schemas";

export function warningCopy(w: string): string {
  const [key, rest = ""] = w.split(/:(.*)/s);
  switch (key) {
    case "single_item_currency":
      return `Only one ${rest.toUpperCase()} invoice: its score is normalized against itself and is not comparable to scores in other currencies.`;
    case "missing_inputs": {
      const n = rest.replace("_records", "");
      return `${n} queued ${n === "1" ? "record has" : "records have"} missing inputs, which lowers confidence. Missing data is never guessed.`;
    }
    case "unrecognized_failure_code":
      return `Unrecognized failure code "${rest}": a default recovery signal (0.30) was used.`;
    case "failed_at_in_future":
      return `Invoice ${rest} has a failure time after the snapshot time; its age was clamped to zero.`;
    case "empty_scope":
      return "No record matched the plan filters, so the queue is empty.";
    case "truncated":
      return `Queues were cut to the top ${rest.replace("top_n=", "")} items. Metrics still cover every record in scope.`;
    default:
      return w;
  }
}

export interface ErrorCopy {
  title: string;
  hint?: string;
}

export function errorCopy(code: string): ErrorCopy {
  switch (code) {
    case "CSV_INVALID":
      return { title: "The CSV could not be imported", hint: "Nothing was loaded. Fix the rows listed below and upload again." };
    case "DATASET_NOT_FOUND":
      return { title: "The dataset is no longer loaded", hint: "Load the demo data or upload your CSV again." };
    case "ANALYSIS_NOT_FOUND":
      return { title: "That analysis is no longer available", hint: "Run the analysis again." };
    case "UNSUPPORTED_REQUEST":
      return { title: "That request is not supported", hint: "Recoverly is read-only analysis. Try one of the example questions." };
    case "LLM_UNAVAILABLE":
      return { title: "The LLM provider is unavailable", hint: "You can still run the saved script with \"Replay saved script\"." };
    case "GENERATION_FAILED":
      return { title: "Code generation failed", hint: "Both attempts are listed below. Nothing unvalidated is shown as a result." };
    case "SANDBOX_UNAVAILABLE":
      return { title: "The CreateOS Sandbox is unavailable", hint: "Check the Sandbox integration chip and the API key." };
    case "SANDBOX_RATE_LIMITED":
      return { title: "CreateOS Sandbox limit reached", hint: "The free plan allows 1 concurrent sandbox and 10 creates per day. Wait and retry." };
    case "SANDBOX_OUT_OF_CREDIT":
      return { title: "CreateOS Sandbox is out of credit", hint: "The operator needs to top up the CreateOS plan." };
    case "SANDBOX_TIMEOUT":
      return { title: "The generated script timed out in the sandbox", hint: "It was killed by the hard time limit. No result was produced." };
    case "SANDBOX_EXEC_FAILED":
      return { title: "The generated script failed in the sandbox", hint: "The error output is shown in the run log." };
    case "RESULT_INVALID":
      return { title: "Rejected malformed output", hint: "The sandbox output failed server-side validation, so it was not shown as a result." };
    case "DRAFT_NOT_ELIGIBLE":
      return { title: "No message is needed" };
    case "APPROVAL_INVALID":
      return { title: "Approval was refused", hint: "Nothing was recorded as approved or sent." };
    case "SEND_FAILED":
      return { title: "Delivery failed", hint: "The approved draft was preserved so you can retry." };
    case "RATE_LIMITED":
      return { title: "Too many analyses", hint: "Wait a moment and try again." };
    case "UNAUTHORIZED":
      return { title: "An access code is required", hint: "Enter the demo access code and try again." };
    default:
      return { title: "Something went wrong" };
  }
}

export const ACTION_LABEL: Record<Action, string> = {
  update_payment_method: "Update payment method",
  wait_for_retry: "Wait for retry",
  review_manually: "Review manually",
  contact_customer: "Contact customer",
  do_not_pursue: "Do not pursue",
};

export const ACTION_WHY: Record<Action, string> = {
  update_payment_method: "The card or authentication has to change. A retry alone will not fix an expired card or a missing authentication.",
  wait_for_retry: "A retry is already scheduled. Contacting the customer now would add noise.",
  review_manually: "The signals are ambiguous or incomplete. A person should look before anything is sent.",
  contact_customer: "No retry will resolve this on its own. A polite reminder with the payment link is the safest next step.",
  do_not_pursue: "The invoice is already resolved.",
};

export const MISSING_COPY: Record<string, string> = {
  failure_message: "The provider message is empty, so the failure detail is thinner.",
  customer_created_at: "The customer creation date is missing, so tenure counts as zero.",
  subscription_id: "The subscription id is missing, so the invoice cannot be tied to a subscription.",
  hosted_invoice_url: "There is no hosted invoice link, so a message cannot include a payment link.",
  next_payment_attempt: "`next_payment_attempt` is unknown, so we cannot tell whether a retry is scheduled.",
  failure_code_unrecognized: "The failure code is not one Recoverly knows, so a default recovery signal was used.",
};

export const STATE_LABEL: Record<string, string> = {
  failed: "Failed",
  in_recovery: "In recovery",
  action_needed: "Action needed",
  recovered: "Recovered",
  not_recovered: "Not recovered",
  unknown: "Unknown",
};
