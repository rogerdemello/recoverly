/**
 * M2 CLI: natural-language question → plan → generated code → CreateOS Sandbox → ranked JSON.
 *
 *   npm run analyze -- "Show me the failed payments most worth recovering."
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runAgent, type FixtureDataset } from "../src/lib/analysis/agent";

const question =
  process.argv.slice(2).join(" ").trim() ||
  "Which failed payments represent the most recoverable revenue? Explain the reason and recommend the next safe action.";

function loadFixture(): FixtureDataset {
  const p = path.join(process.cwd(), "data", "fixture-failed-payments.json");
  return JSON.parse(readFileSync(p, "utf8")) as FixtureDataset;
}

function money(minor: number, currency: string): string {
  return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

async function main(): Promise<void> {
  console.log("── Recoverly agent ──────────────────────────────");
  console.log("Question:", question);
  console.log("");

  const outcome = await runAgent(question, loadFixture());

  if (!outcome.ok) {
    console.error(`FAILED at stage: ${outcome.stage} (attempts=${outcome.attempts})`);
    console.error(outcome.message);
    if (outcome.plan) {
      console.error("\nPlan that was used:");
      console.error(JSON.stringify(outcome.plan, null, 2));
    }
    if (outcome.sandbox?.stderr) {
      console.error("\nSandbox stderr (truncated):");
      console.error(outcome.sandbox.stderr.slice(0, 2000));
    }
    if (outcome.code) {
      console.error("\nGenerated code:");
      console.error(outcome.code);
    }
    process.exit(1);
  }

  const { plan, code, result, sandbox, attempts, warnings } = outcome;

  console.log("── Plan ─────────────────────────────────────────");
  console.log(JSON.stringify(plan, null, 2));
  console.log("");

  console.log("── Generated code (ran in CreateOS Sandbox) ─────");
  console.log(code);
  console.log("");

  console.log("── Execution ────────────────────────────────────");
  console.log(
    `status=${sandbox.status} exit=${sandbox.exitCode} exec_ms=${sandbox.execMs} sandbox=${sandbox.sandboxId} attempts=${attempts}`,
  );
  for (const w of warnings) console.log(`warning: ${w}`);
  console.log("");

  console.log("── Result ───────────────────────────────────────");
  console.log(result.summary);
  console.log("");
  console.log("Metrics by currency:");
  for (const [cur, m] of Object.entries(result.metrics.by_currency)) {
    console.log(
      `  ${cur.toUpperCase()}: at risk ${money(m.amount_at_risk_minor, cur)} · ${m.failed_count} failures · ${m.customer_count} customers`,
    );
  }
  console.log("");
  console.log("By failure code:");
  for (const [code2, m] of Object.entries(result.metrics.by_failure_code)) {
    const amounts = Object.entries(m.amount_by_currency)
      .map(([c, a]) => money(a, c))
      .join(" + ");
    console.log(`  ${code2}: ${m.count} (${amounts})`);
  }
  console.log("");
  if (result.ranked_items.length === 0) {
    console.log("Ranked queue: empty (no records matched).");
    for (const w of result.warnings) console.log(`  - ${w}`);
  } else {
    console.log(`Ranked queue (top ${result.ranked_items.length}):`);
    for (const item of result.ranked_items) {
      console.log(
        `  #${item.rank} [${item.priority.toUpperCase()} ${item.priority_score.toFixed(3)}] ` +
          `${item.customer_id} · ${money(item.amount_due, item.currency)} · ${item.failure_code} → ${item.recommended_action} ` +
          `(confidence ${item.confidence.toFixed(2)})`,
      );
      if (item.rank_reason) console.log(`       ${item.rank_reason}`);
      if (item.missing_fields.length) console.log(`       missing: ${item.missing_fields.join(", ")}`);
    }
  }

  if (result.warnings.length) {
    console.log("");
    console.log("Result warnings:");
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  if (result.data_quality.notes.length) {
    console.log("");
    console.log("Data quality:");
    for (const n of result.data_quality.notes) console.log(`  - ${n}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Agent crashed:", err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
