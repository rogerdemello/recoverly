/**
 * M0 spike: proves the CreateOS Sandbox assumptions in docs/implementation-plan.md against the real service.
 *
 *   npm run spike:sandbox              # reuses/creates the shared "recoverly-runner" sandbox
 *   npm run spike:sandbox -- --destroy # also destroys it afterwards
 *
 * Spends at most ONE sandbox create (free plan: 10/day). Prints credential NAMES only, never values.
 */
import {
  EGRESS_DENY_ALL,
  RUNNER_NAME,
  getClient,
  getRunnerSandbox,
  invalidateRunnerSandbox,
  runPython,
  sandboxConfigured,
  describeSandboxError,
} from "../src/lib/sandbox/runner";

type Check = { name: string; ok: boolean; detail: string; informational?: boolean };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string, informational = false) => {
  checks.push({ name, ok, detail, informational });
  console.log(`${informational ? "INFO" : ok ? "PASS" : "FAIL"}  ${name}: ${detail}`);
};

const NET_PROBE = `
import urllib.request, sys
try:
    with urllib.request.urlopen("https://example.com", timeout=6) as r:
        print("reachable", r.status)
except Exception as e:
    print("blocked", type(e).__name__)
`;

async function main() {
  // 0. Which credential variables exist (names only).
  const names = Object.keys(process.env).filter((k) => /^(CREATEOS|STRIPE|OPENROUTER|ANTHROPIC)/i.test(k)).sort();
  record("env var names present", true, names.length ? names.join(", ") : "(none loaded; is .env present?)", true);
  if (!sandboxConfigured()) {
    record("CREATEOS_SANDBOX_API_KEY", false, "not set. Check the names above against `stripe projects env`; the SDK expects CREATEOS_SANDBOX_API_KEY.");
    return;
  }

  // 1. Identity + catalog (unauthenticated shapes call also proves reachability).
  const client = getClient();
  try {
    const me = await client.whoami();
    record("whoami", true, `stats=${JSON.stringify(me.stats)}`);
    const shapes = await client.listShapes();
    record("shape s-1vcpu-1gb available", shapes.some((s) => s.id === "s-1vcpu-1gb"), shapes.map((s) => s.id).join(", "));
  } catch (e) {
    record("control plane reachable", false, describeSandboxError(e));
    return;
  }

  // 2. Acquire (create or reuse) the shared sandbox.
  const sandbox = await getRunnerSandbox();
  record("acquire sandbox", true, `id=${sandbox.id} status=${sandbox.status} shape=${sandbox.data.shape} rootfs=${sandbox.data.rootfs} spawn_ms=${sandbox.data.spawn_ms ?? "n/a"}`);

  // 3. Runtime facts the plan depends on.
  const facts = await runPython({
    entry: "main.py",
    files: [
      {
        path: "main.py",
        content: `
import sys, shutil, json
out = {"python": sys.version.split()[0], "timeout_bin": bool(shutil.which("timeout"))}
try:
    import pandas
    out["pandas"] = pandas.__version__
except Exception as e:
    out["pandas"] = None
print(json.dumps(out))
`,
      },
    ],
  });
  record("python runs", facts.status === "ok", facts.status === "ok" ? facts.stdout.trim() : `${facts.status} ${facts.error ?? facts.stderr}`);
  if (facts.status === "ok") {
    const parsed = JSON.parse(facts.stdout.trim()) as { pandas: string | null; timeout_bin: boolean };
    record("GNU timeout available", parsed.timeout_bin, String(parsed.timeout_bin));
    record("pandas available", parsed.pandas !== null, `${parsed.pandas ?? "missing"} (scoring lib is stdlib-only either way)`, true);
  }

  // 4. Multi-file upload with an import between files (recoverly_lib.py + generated script layout).
  const multi = await runPython({
    entry: "main.py",
    files: [
      { path: "lib/helper.py", content: "def f():\n    return 41 + 1\n" },
      { path: "lib/__init__.py", content: "" },
      { path: "main.py", content: "from lib.helper import f\nprint(f())\n" },
    ],
  });
  record("multi-file import", multi.status === "ok" && multi.stdout.trim() === "42", `${multi.status} stdout=${multi.stdout.trim()}`);

  // 5. Failure shapes must be distinguishable and never look like success.
  const crash = await runPython({ entry: "main.py", files: [{ path: "main.py", content: "raise ValueError('boom')\n" }] });
  record("non-zero exit surfaced", crash.status === "nonzero_exit" && crash.stderr.includes("boom"), `status=${crash.status} exit=${crash.exitCode}`);

  const t0 = Date.now();
  const hang = await runPython({ entry: "main.py", timeoutSeconds: 3, files: [{ path: "main.py", content: "import time\ntime.sleep(60)\n" }] });
  record("timeout enforced in-sandbox", hang.status === "timeout" && Date.now() - t0 < 15_000, `status=${hang.status} exit=${hang.exitCode} wall=${Date.now() - t0}ms`);

  // 6. Egress: baseline open, then locked. Exec must keep working while locked.
  await sandbox.setEgress(null);
  const open = await runPython({ entry: "main.py", files: [{ path: "main.py", content: NET_PROBE }] });
  record("egress baseline (open)", true, open.stdout.trim() || open.stderr.trim() || open.status, true);

  await sandbox.setEgress(EGRESS_DENY_ALL);
  const locked = await runPython({ entry: "main.py", files: [{ path: "main.py", content: NET_PROBE }] });
  record("egress locked blocks outbound", locked.status === "ok" && locked.stdout.startsWith("blocked"), locked.stdout.trim() || locked.stderr.trim() || locked.status);
  record("exec works while egress locked", locked.status === "ok", `status=${locked.status}`);
  const rules = (await sandbox.getEgress()).egress;
  record("egress rules stored", JSON.stringify(rules) === JSON.stringify(EGRESS_DENY_ALL), JSON.stringify(rules));

  // 7. Reuse: dropping the cache must find the SAME sandbox by name, not create a second one.
  invalidateRunnerSandbox();
  const again = await getRunnerSandbox();
  record("reuse by name (no 2nd create)", again.id === sandbox.id, `${RUNNER_NAME}: ${sandbox.id} -> ${again.id}`);

  if (process.argv.includes("--destroy")) {
    await again.destroy();
    record("destroyed", true, again.id, true);
  }
}

main()
  .catch((e) => record("spike crashed", false, describeSandboxError(e)))
  .finally(() => {
    const failed = checks.filter((c) => !c.ok && !c.informational);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks OK${failed.length ? `; FAILED: ${failed.map((c) => c.name).join("; ")}` : ""}`);
    process.exit(failed.length ? 1 : 0);
  });
