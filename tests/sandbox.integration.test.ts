/**
 * Opt-in live checks against the real CreateOS Sandbox (spends no extra sandbox creates; reuses the named one).
 *   RUN_SANDBOX_TESTS=1 npm test
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toSandboxData } from "../src/lib/domain/csv";
import { runPython } from "../src/lib/sandbox/runner";
import { loadFixtureDataset } from "../src/lib/store";
import { golden } from "./helpers";

const live = process.env.RUN_SANDBOX_TESTS === "1";
const root = process.cwd();
const lib = readFileSync(path.join(root, "sandbox", "recoverly_lib.py"), "utf8");
const replay = readFileSync(path.join(root, "sandbox", "replay", "rank_recoverable.py"), "utf8");

describe.skipIf(!live)("live sandbox", () => {
  const ds = loadFixtureDataset();
  const data = JSON.stringify(toSandboxData(ds.asOf, ds.records));
  const files = (code: string) => [
    { path: "recoverly_lib.py", content: lib },
    { path: "data.json", content: data },
    { path: "main.py", content: code },
  ];

  it("reproduces Golden B byte for byte from the saved script", async () => {
    const run = await runPython({ entry: "main.py", timeoutSeconds: 20, files: files(replay) });
    expect(run.status).toBe("ok");
    expect(JSON.parse(run.stdout)).toEqual(golden("golden-b"));
  }, 60_000);

  it("surfaces a non-zero exit", async () => {
    const run = await runPython({ entry: "main.py", timeoutSeconds: 10, files: files("import sys\nsys.exit(3)") });
    expect(run).toMatchObject({ status: "nonzero_exit", exitCode: 3 });
  }, 60_000);

  it("enforces the hard timeout", async () => {
    const run = await runPython({ entry: "main.py", timeoutSeconds: 2, files: files("while True:\n    pass") });
    expect(run.status).toBe("timeout");
  }, 60_000);

  it("blocks outbound network access", async () => {
    const code = `import urllib.request\ntry:\n    urllib.request.urlopen("https://example.com", timeout=5)\n    print("reachable")\nexcept Exception:\n    print("blocked")\n`;
    const run = await runPython({ entry: "main.py", timeoutSeconds: 15, files: files(code) });
    expect(run.stdout.trim()).toBe("blocked");
  }, 60_000);
});
