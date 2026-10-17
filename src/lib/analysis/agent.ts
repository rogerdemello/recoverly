/**
 * Recoverly agent loop (server-only): NL question → plan → generated Python →
 * CreateOS Sandbox → validated ranked JSON. One automatic retry with error feedback.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { analysisPlanSchema, analysisResultSchema, type AnalysisPlan, type AnalysisResult } from "./schemas";
import { guardGeneratedCode, MAX_SCRIPT_BYTES } from "./guard";
import { chatJSON, chatText } from "./llm";
import { runPython, describeSandboxError, type SandboxRunResult } from "../sandbox/runner";

export interface FixtureDataset {
  dataset_id: string;
  synthetic: boolean;
  records: Array<Record<string, unknown>>;
}

export interface AgentRunSuccess {
  ok: true;
  plan: AnalysisPlan;
  code: string;
  result: AnalysisResult;
  sandbox: Pick<SandboxRunResult, "status" | "exitCode" | "execMs" | "sandboxId">;
  attempts: number;
  warnings: string[];
}

export interface AgentRunFailure {
  ok: false;
  plan: AnalysisPlan | null;
  code: string | null;
  stage: "plan" | "codegen" | "guard" | "sandbox" | "validate" | "llm";
  message: string;
  attempts: number;
  sandbox?: Pick<SandboxRunResult, "status" | "exitCode" | "stderr" | "execMs" | "sandboxId" | "error">;
}

export type AgentRunOutcome = AgentRunSuccess | AgentRunFailure;

const PLAN_SYSTEM = `You are the Recoverly planner. Convert the operator's question about failed subscription payments into a strict JSON analysis plan.

Schema (JSON object, no prose):
{
  "question": string,
  "intent": "rank_recoverable" | "breakdown" | "customer_investigate" | "compare" | "other",
  "filters": {
    "min_amount_minor"?: integer minor units (cents),
    "max_amount_minor"?: integer,
    "currency"?: lowercase 3-letter code,
    "failed_within_days"?: number,
    "failure_codes"?: string[],
    "invoice_status"?: string[],
    "recovery_state"?: string[]
  },
  "metrics": subset of ["total_amount_at_risk","failed_count","customer_count","by_failure_code","by_recovery_status","recovery_rate"],
  "rank_by": "priority_score" | "amount_due" | "confidence",
  "top_n": integer 1-50,
  "rationale": string explaining the plan in one sentence
}

Rules:
- Amounts in the dataset are MINOR units (cents). $100 => 10000.
- "last seven days" means failed_within_days: 7.
- Only include filters the question supports. Set "currency" whenever the question names one (e.g. "100 USD" => currency: "usd").
- Default intent is rank_recoverable; default metrics at least ["total_amount_at_risk","failed_count","customer_count","by_failure_code","by_recovery_status"].
- Only include filters the question supports. Return ONLY the JSON object.`;

function buildPlanUser(question: string): string {
  return `Question: ${question}\n\nReturn the analysis plan JSON.`;
}

const CODEGEN_SYSTEM = `You are the Recoverly code generator. Write a short Python 3 analysis script that follows this EXACT usage contract:

    import json
    from recoverly_lib import load_records, rank_records, summarize, data_quality

    records = load_records("data.json")          # list[dict]
    # apply plan filters to records -> filtered_records (list of the same dict shape)
    ranked = rank_records(filtered_records)       # sorted by priority_score desc, each has rank 1..N
    # if re-sorting by plan.rank_by (amount_due/confidence): sort, then reassign rank = i+1 for i,x in enumerate(list)
    top = ranked[: plan_top_n]
    for item in top:
        item["rank_reason"] = "one short sentence from score_components/notes"
    metrics = summarize(filtered_records)         # ONE argument only: the filtered records list
    dq = data_quality(filtered_records)           # ONE argument only
    output = {
      "summary": "one sentence",
      "metrics": metrics,
      "ranked_items": top,                        # must be non-empty
      "warnings": ["filters applied, currency notes, ..."],
      "data_quality": dq,
    }
    print(json.dumps(output))

Filter fields map to record keys as: min_amount_minor/max_amount_minor → amount_due, currency → currency (lowercase compare), failed_within_days → parse failed_at (ISO, may end with Z) and keep rows within N days of the NEWEST failed_at in the dataset (not wall-clock now), failure_codes → failure_code, invoice_status → invoice_status, recovery_state → recovery_state.

Hard rules:
- ONLY import json plus names from recoverly_lib. NEVER import socket/subprocess/urllib/requests/httpx/os/shutil/pathlib.
- Do NOT open/read/write files yourself — load_records("data.json") is the only I/O.
- Pass ranked items to the output AS RETURNED by rank_records (after optional re-sort). Do NOT strip or rebuild item keys. Do NOT reference keys that are not on the item dicts.
- If filters leave zero rows: DO NOT invent or pad items. Set ranked_items: [] and put an explicit warning string (e.g. "No records matched filters X"). An empty queue is valid.
- summarize() and data_quality() each take exactly ONE argument: the filtered records list.
- Never sum across currencies (summarize already groups by currency).
- Print exactly one JSON document via json.dumps. Nothing else on stdout.

AnalysisPlan JSON:
{{PLAN}}

Return ONLY Python source. No markdown fences. No commentary.`;

function extractJsonFromStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Sandbox produced empty stdout.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Stdout is not a JSON document.");
  }
}

function stripFences(code: string): string {
  const trimmed = code.trim();
  const fence = /^```(?:python|py)?\n([\s\S]*?)\n```$/m.exec(trimmed);
  return fence?.[1] ?? trimmed;
}

/** Removes PII columns before the dataset enters the sandbox. Drafter resolves emails server-side later. */
export function sanitizeForSandbox(dataset: FixtureDataset): { records: Array<Record<string, unknown>>; stripped: string[] } {
  const stripped: string[] = [];
  const records = dataset.records.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    if ("customer_email" in copy) {
      delete copy.customer_email;
      if (!stripped.includes("customer_email")) stripped.push("customer_email");
    }
    return copy;
  });
  return { records, stripped };
}

function loadRecoverlyLib(): string {
  return readFileSync(path.join(process.cwd(), "src", "lib", "analysis", "recoverly_lib.py"), "utf8");
}

export async function runAgent(
  question: string,
  dataset: FixtureDataset,
): Promise<AgentRunOutcome> {
  if (!dataset.synthetic && dataset.records.length === 0) {
    return { ok: false, plan: null, code: null, stage: "plan", message: "Dataset is empty.", attempts: 0 };
  }

  // 1. Plan
  let plan: AnalysisPlan;
  try {
    const rawPlan = await chatJSON<unknown>(PLAN_SYSTEM, buildPlanUser(question));
    plan = analysisPlanSchema.parse(rawPlan);
  } catch (err) {
    return {
      ok: false,
      plan: null,
      code: null,
      stage: "plan",
      message: `Planner failed: ${err instanceof Error ? err.message : String(err)}`,
      attempts: 0,
    };
  }

  const { records, stripped } = sanitizeForSandbox(dataset);
  const warnings: string[] = [];
  if (stripped.length) {
    warnings.push(`Stripped before sandbox: ${stripped.join(", ")} (PII minimization).`);
  }
  if (dataset.synthetic) {
    warnings.push("Dataset is synthetic (hackathon fixture).");
  }

  const lib = loadRecoverlyLib();
  const dataJson = JSON.stringify({ dataset_id: dataset.dataset_id, synthetic: dataset.synthetic, records });
  let lastFailure: AgentRunFailure = {
    ok: false,
    plan,
    code: null,
    stage: "codegen",
    message: "Codegen did not run.",
    attempts: 0,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    console.error(`[agent] attempt ${attempt}/2: codegen…`);
    // 2. Codegen
    let code: string;
    try {
      const system = CODEGEN_SYSTEM.replace("{{PLAN}}", JSON.stringify(plan, null, 2));
      const user =
        attempt > 1 && lastFailure.ok === false
          ? `Previous script failed. Fix it.\n\nFailure stage: ${lastFailure.stage}\nFailure message: ${lastFailure.message}\n${lastFailure.sandbox?.stderr ? `Stderr:\n${lastFailure.sandbox.stderr.slice(0, 1500)}` : ""}\n${lastFailure.code ? `Previous script:\n${lastFailure.code}` : ""}`
          : "Generate the script for this plan.";
      const raw = await chatText(system, user);
      code = stripFences(raw);
    } catch (err) {
      return {
        ok: false,
        plan,
        code: null,
        stage: "codegen",
        message: `Codegen failed: ${err instanceof Error ? err.message : String(err)}`,
        attempts: attempt,
      };
    }

    // 3. Static guard
    const guard = guardGeneratedCode(code);
    if (!guard.ok) {
      lastFailure = {
        ok: false,
        plan,
        code,
        stage: "guard",
        message: guard.reason,
        attempts: attempt,
      };
      if (attempt === 2) return lastFailure;
      continue;
    }

    // 4. Sandbox
    console.error(`[agent] attempt ${attempt}/2: sandbox run (${code.length} bytes)…`);
    let run: SandboxRunResult;
    try {
      run = await runPython({
        entry: "script.py",
        timeoutSeconds: 30,
        files: [
          { path: "recoverly_lib.py", content: lib },
          { path: "data.json", content: dataJson },
          { path: "script.py", content: code },
        ],
      });
    } catch (err) {
      return {
        ok: false,
        plan,
        code,
        stage: "sandbox",
        message: describeSandboxError(err),
        attempts: attempt,
      };
    }

    if (run.status !== "ok") {
      lastFailure = {
        ok: false,
        plan,
        code,
        stage: "sandbox",
        message:
          run.status === "timeout"
            ? "Sandbox execution timed out (30s limit)."
            : run.status === "nonzero_exit"
              ? `Script exited ${run.exitCode}.`
              : run.error || "Sandbox error.",
        attempts: attempt,
        sandbox: run,
      };
      if (attempt === 2) return lastFailure;
      continue;
    }

    // 5. Validate
    try {
      const parsed = extractJsonFromStdout(run.stdout);
      const result = analysisResultSchema.parse(parsed);
      return {
        ok: true,
        plan,
        code,
        result,
        sandbox: {
          status: run.status,
          exitCode: run.exitCode,
          execMs: run.execMs,
          sandboxId: run.sandboxId,
        },
        attempts: attempt,
        warnings,
      };
    } catch (err) {
      lastFailure = {
        ok: false,
        plan,
        code,
        stage: "validate",
        message: `Output failed schema validation: ${err instanceof Error ? err.message : String(err)}`,
        attempts: attempt,
        sandbox: run,
      };
      if (attempt === 2) return lastFailure;
    }
  }

  return lastFailure;
}

export { MAX_SCRIPT_BYTES };
