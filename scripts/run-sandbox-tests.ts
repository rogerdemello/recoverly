/** Cross-platform wrapper: runs the opt-in live sandbox tests with .env loaded and RUN_SANDBOX_TESTS=1. */
import { spawnSync } from "node:child_process";

const res = spawnSync(process.execPath, ["--env-file=.env", "node_modules/vitest/vitest.mjs", "run", "tests/sandbox.integration.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, RUN_SANDBOX_TESTS: "1" },
});
process.exit(res.status ?? 1);
