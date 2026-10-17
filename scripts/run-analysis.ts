/**
 * CLI for the whole agent: question -> plan -> generated Python -> CreateOS Sandbox -> validated queue.
 *
 *   npm run analyze -- "What are the top failure reasons?"
 *   npm run analyze -- --replay            # run the saved script (no LLM)
 */
import { runPipeline } from "../src/lib/agent/pipeline";
import { formatMoney } from "../src/lib/domain/money";
import { DEMO_QUESTION } from "../src/lib/domain/schemas";
import { loadFixtureDataset } from "../src/lib/store";

const args = process.argv.slice(2);
const replay = args.includes("--replay");
const question = args.filter((a) => !a.startsWith("--")).join(" ").trim() || DEMO_QUESTION;

async function main() {
  console.log(`Question: ${question}${replay ? "  [replay]" : ""}\n`);
  const outcome = await runPipeline({
    dataset: loadFixtureDataset(),
    question,
    analysisId: "cli",
    replay,
    emit: (event, data) => {
      if (event === "plan") console.log("PLAN", JSON.stringify((data as { plan: unknown }).plan));
      if (event === "guard") console.log("GUARD", JSON.stringify(data));
      if (event === "sandbox") console.log("SANDBOX", JSON.stringify(data));
      if (event === "code") console.log(`CODE (attempt ${(data as { attempt: number }).attempt}):\n${(data as { code: string }).code}\n`);
    },
  });

  if (!outcome.ok) {
    console.error(`\nFAILED ${outcome.code}: ${outcome.message}`);
    if (outcome.details) console.error(JSON.stringify(outcome.details, null, 2));
    process.exit(1);
  }

  const { result } = outcome;
  console.log(`\n${result.summary}`);
  for (const w of result.warnings) console.log(`warning: ${w}`);
  for (const q of result.queues) {
    console.log(`\n${q.currency.toUpperCase()} queue`);
    for (const i of q.items) {
      console.log(
        `  #${i.rank} ${i.invoice_id} ${formatMoney(i.amount_minor, i.currency)} ${i.priority.toUpperCase()} ${i.score} ${i.state} -> ${i.recommended_action} (${i.confidence})`,
      );
    }
  }
  if (result.resolved.length) console.log(`\nResolved: ${result.resolved.map((r) => r.invoice_id).join(", ")}`);
  if (result.metrics.by_failure_code.length) {
    console.log("\nBy failure code:");
    for (const r of result.metrics.by_failure_code) console.log(`  ${r.currency} ${r.failure_code}: ${r.count} / ${formatMoney(r.amount_minor, r.currency)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
