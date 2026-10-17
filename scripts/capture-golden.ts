/**
 * Runs the saved replay script (and an unfiltered variant) in the CreateOS Sandbox and writes the outputs to
 * tests/fixtures/golden-{a,b}.json. Offline tests then validate those files against the numbers in
 * docs/fixture-spec.md, and RUN_SANDBOX_TESTS=1 re-checks them live.
 *
 *   npm run capture:golden
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { toSandboxData } from "../src/lib/domain/csv";
import { runPython } from "../src/lib/sandbox/runner";
import { loadFixtureDataset } from "../src/lib/store";

const root = process.cwd();
const lib = readFileSync(path.join(root, "sandbox", "recoverly_lib.py"), "utf8");
const replay = readFileSync(path.join(root, "sandbox", "replay", "rank_recoverable.py"), "utf8");
const dataset = loadFixtureDataset();
const data = JSON.stringify(toSandboxData(dataset.asOf, dataset.records));

const PLAN_A = JSON.stringify({
  intent: "rank_recoverable",
  filters: {},
  group_by: [],
  top_n: 50,
  then_draft: false,
  explanation: "Rank every unresolved failed payment.",
  fields_used: ["amount_due", "failure_code"],
});
const scriptA = replay.replace(/json\.loads\(r'''.*?'''\)/s, `json.loads(r'''${PLAN_A}''')`);

async function capture(name: string, code: string) {
  const run = await runPython({
    entry: "main.py",
    timeoutSeconds: 20,
    files: [
      { path: "recoverly_lib.py", content: lib },
      { path: "data.json", content: data },
      { path: "main.py", content: code },
    ],
  });
  if (run.status !== "ok") throw new Error(`${name}: ${run.status} ${run.stderr || run.error}`);
  mkdirSync(path.join(root, "tests", "fixtures"), { recursive: true });
  writeFileSync(path.join(root, "tests", "fixtures", `${name}.json`), `${JSON.stringify(JSON.parse(run.stdout), null, 2)}\n`);
  console.log(`wrote tests/fixtures/${name}.json (${run.stdout.length} bytes, ${run.execMs} ms)`);
}

await capture("golden-b", replay);
await capture("golden-a", scriptA);
