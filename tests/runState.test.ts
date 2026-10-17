import { describe, expect, it } from "vitest";
import { failRun, initialRun, reduceEvent } from "../src/lib/client/runState";
import { warningCopy } from "../src/lib/client/copy";
import { DEMO_PLAN } from "../src/lib/domain/schemas";
import { golden } from "./helpers";

describe("run state reducer", () => {
  it("walks the stepper through a successful run", () => {
    let s = initialRun(0);
    expect(s.steps.plan.status).toBe("running");
    s = reduceEvent(s, "plan", { analysisId: "a", plan: DEMO_PLAN, source: "generated" }, 1000);
    expect(s.steps.plan).toEqual({ status: "ok", ms: 1000 });
    expect(s.steps.code.status).toBe("running");
    s = reduceEvent(s, "code", { attempt: 1, source: "generated", code: "print(1)" }, 3000);
    expect(s.steps.code).toEqual({ status: "ok", ms: 2000 });
    s = reduceEvent(s, "guard", { attempt: 1, ok: true, violations: [] }, 3010);
    s = reduceEvent(s, "sandbox", { attempt: 1, status: "ok", exitCode: 0, execMs: 74, sandboxId: "sb-1", stderrTail: "" }, 3200);
    expect(s.steps.sandbox).toEqual({ status: "ok", ms: 74 });
    s = reduceEvent(s, "result", { analysisId: "a", result: golden("golden-b") }, 3300);
    s = reduceEvent(s, "done", {}, 3301);
    expect(s.steps.validate.status).toBe("ok");
    expect(s.running).toBe(false);
    expect(s.result).not.toBeNull();
  });

  it("keeps the failed first attempt visible when a retry succeeds", () => {
    let s = initialRun(0);
    s = reduceEvent(s, "plan", { analysisId: "a", plan: DEMO_PLAN, source: "generated" }, 10);
    s = reduceEvent(s, "code", { attempt: 1, source: "generated", code: "import os" }, 20);
    s = reduceEvent(s, "guard", { attempt: 1, ok: false, violations: ["import_not_allowed:os"] }, 30);
    expect(s.steps.guard.status).toBe("failed");
    s = reduceEvent(s, "code", { attempt: 2, source: "generated", code: "ok" }, 40);
    expect(s.attempt).toBe(2);
    expect(s.steps.guard.status).toBe("running");
    expect(s.attempts).toHaveLength(2);
    expect(s.attempts[0]!.guard).toMatchObject({ ok: false });
  });

  it("marks the in-flight step failed on error so it never looks like success", () => {
    let s = initialRun(0);
    s = reduceEvent(s, "plan", { analysisId: "a", plan: DEMO_PLAN, source: "generated" }, 10);
    s = reduceEvent(s, "code", { attempt: 1, source: "generated", code: "x" }, 20);
    s = reduceEvent(s, "guard", { attempt: 1, ok: true, violations: [] }, 30);
    s = reduceEvent(s, "sandbox", { attempt: 1, status: "timeout", exitCode: 124, execMs: 20000, sandboxId: "sb-1", stderrTail: "" }, 40);
    expect(s.steps.sandbox.status).toBe("failed");
    s = reduceEvent(s, "error", { code: "SANDBOX_TIMEOUT", message: "timed out" }, 50);
    s = reduceEvent(s, "done", {}, 51);
    expect(s.error?.code).toBe("SANDBOX_TIMEOUT");
    expect(s.result).toBeNull();
  });

  it("fails the planning step when the plan is unsupported-then-error", () => {
    let s = initialRun(0);
    s = reduceEvent(s, "plan", { analysisId: "a", plan: { ...DEMO_PLAN, intent: "unsupported", unsupported_reason: "no" }, source: "generated" }, 10);
    expect(s.steps.code.status).toBe("pending");
    s = reduceEvent(s, "error", { code: "UNSUPPORTED_REQUEST", message: "no" }, 20);
    expect(Object.values(s.steps).filter((x) => x.status === "failed")).toHaveLength(0);
  });

  it("failRun handles a dropped connection", () => {
    const s = failRun(initialRun(0), { code: "GENERATION_FAILED", message: "dropped" }, 5);
    expect(s.steps.plan.status).toBe("failed");
    expect(s.running).toBe(false);
  });
});

describe("warning copy", () => {
  it("explains the single-item currency warning", () => {
    expect(warningCopy("single_item_currency:eur")).toContain("Only one EUR invoice");
  });
  it("falls back to the raw text for unknown warnings", () => {
    expect(warningCopy("something_new:1")).toBe("something_new:1");
  });
});
