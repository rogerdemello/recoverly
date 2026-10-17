import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setLlmForTesting, LlmUnavailableError, type Llm } from "../src/lib/agent/llm";
import { runPipeline, type RunPythonFn } from "../src/lib/agent/pipeline";
import { DEMO_PLAN, DEMO_QUESTION } from "../src/lib/domain/schemas";
import { loadFixtureDataset } from "../src/lib/store";
import { clone, golden } from "./helpers";

const replayScript = readFileSync(path.join(process.cwd(), "sandbox", "replay", "rank_recoverable.py"), "utf8");
const goldenStdout = JSON.stringify(golden("golden-b"));
const dataset = loadFixtureDataset();

const ok = (stdout: string): RunPythonFn => async () => ({ status: "ok", exitCode: 0, stdout, stderr: "", execMs: 70, sandboxId: "sb-abcdef123456" });

function stubLlm(replies: { json?: string[]; text?: string[] }): Llm & { calls: { json: number; text: number } } {
  const calls = { json: 0, text: 0 };
  return {
    calls,
    async json() {
      const r = replies.json?.[calls.json++];
      if (r === undefined) throw new LlmUnavailableError("The LLM provider failed.");
      return r;
    },
    async text() {
      const r = replies.text?.[calls.text++];
      if (r === undefined) throw new LlmUnavailableError("The LLM provider failed.");
      return r;
    },
  };
}

const planReply = JSON.stringify(DEMO_PLAN);
const fenced = (code: string) => `\`\`\`python\n${code}\n\`\`\``;

async function run(opts: { runPython: RunPythonFn; replay?: boolean; question?: string }) {
  const events: Array<[string, any]> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const outcome = await runPipeline({
    dataset,
    question: opts.question ?? DEMO_QUESTION,
    analysisId: "an_test",
    replay: opts.replay,
    runPython: opts.runPython,
    emit: (e, d) => events.push([e, d]),
  });
  return { outcome, events, names: events.map(([e]) => e) };
}

afterEach(() => setLlmForTesting(null));

describe("pipeline with a stub LLM", () => {
  it("emits plan, code, guard, sandbox, result in order and returns Golden B", async () => {
    setLlmForTesting(stubLlm({ json: [planReply], text: [fenced(replayScript)] }));
    const { outcome, names, events } = await run({ runPython: ok(goldenStdout) });
    expect(outcome.ok).toBe(true);
    expect(names).toEqual(["plan", "code", "guard", "sandbox", "result"]);
    expect(events.find(([e]) => e === "code")![1]).toMatchObject({ attempt: 1, source: "generated" });
    expect(events.find(([e]) => e === "sandbox")![1]).toMatchObject({ status: "ok", sandboxId: "sb-abcde" });
    if (outcome.ok) expect(outcome.result.queues[0]!.items[0]!.invoice_id).toBe("in_synth_001");
  });

  it("retries once after a guard rejection and then succeeds", async () => {
    const llm = stubLlm({ json: [planReply], text: [fenced("import os\nprint('x')"), fenced(replayScript)] });
    setLlmForTesting(llm);
    const { outcome, events } = await run({ runPython: ok(goldenStdout) });
    expect(outcome.ok).toBe(true);
    expect(llm.calls.text).toBe(2);
    const guards = events.filter(([e]) => e === "guard").map(([, d]) => d);
    expect(guards[0]).toMatchObject({ attempt: 1, ok: false });
    expect(guards[0].violations).toContain("import_not_allowed:os");
    expect(guards[1]).toMatchObject({ attempt: 2, ok: true });
  });

  it("surfaces a non-zero exit after the retry as SANDBOX_EXEC_FAILED with both attempts", async () => {
    setLlmForTesting(stubLlm({ json: [planReply], text: [fenced(replayScript), fenced(replayScript)] }));
    const runPython: RunPythonFn = async () => ({ status: "nonzero_exit", exitCode: 1, stdout: "", stderr: "Traceback: boom", execMs: 5, sandboxId: "sb-1" });
    const { outcome, names } = await run({ runPython });
    expect(outcome).toMatchObject({ ok: false, code: "SANDBOX_EXEC_FAILED" });
    if (!outcome.ok) expect(outcome.details).toHaveLength(2);
    expect(names).not.toContain("result");
  });

  it("maps a timeout to SANDBOX_TIMEOUT", async () => {
    setLlmForTesting(stubLlm({ json: [planReply], text: [fenced(replayScript), fenced(replayScript)] }));
    const runPython: RunPythonFn = async () => ({ status: "timeout", exitCode: 124, stdout: "", stderr: "", execMs: 20000, sandboxId: "sb-1" });
    expect((await run({ runPython })).outcome).toMatchObject({ ok: false, code: "SANDBOX_TIMEOUT" });
  });

  it("rejects malformed output as RESULT_INVALID instead of showing it", async () => {
    setLlmForTesting(stubLlm({ json: [planReply], text: [fenced(replayScript), fenced(replayScript)] }));
    const { outcome, names } = await run({ runPython: ok("not json at all") });
    expect(outcome).toMatchObject({ ok: false, code: "RESULT_INVALID" });
    expect(names).not.toContain("result");
  });

  it("rejects a tampered result (record count) as RESULT_INVALID", async () => {
    const tampered = clone(golden("golden-b"));
    tampered.metrics.records_in_scope = 3;
    setLlmForTesting(stubLlm({ json: [planReply], text: [fenced(replayScript), fenced(replayScript)] }));
    const { outcome } = await run({ runPython: ok(JSON.stringify(tampered)) });
    expect(outcome).toMatchObject({ ok: false, code: "RESULT_INVALID" });
  });

  it("does not regenerate for sandbox infrastructure errors", async () => {
    const llm = stubLlm({ json: [planReply], text: [fenced(replayScript), fenced(replayScript)] });
    setLlmForTesting(llm);
    const runPython: RunPythonFn = async () => ({ status: "sandbox_error", exitCode: null, stdout: "", stderr: "", execMs: null, sandboxId: null, error: "out of credit", errorCode: "SANDBOX_OUT_OF_CREDIT" });
    const { outcome } = await run({ runPython });
    expect(outcome).toMatchObject({ ok: false, code: "SANDBOX_OUT_OF_CREDIT" });
    expect(llm.calls.text).toBe(1);
  });

  it("reports GENERATION_FAILED when the model never returns a code block", async () => {
    setLlmForTesting(stubLlm({ json: [planReply], text: ["no code here", "still nothing"] }));
    expect((await run({ runPython: ok(goldenStdout) })).outcome).toMatchObject({ ok: false, code: "GENERATION_FAILED" });
  });

  it("returns UNSUPPORTED_REQUEST with the reason and generates no code", async () => {
    const unsupported = JSON.stringify({ intent: "unsupported", filters: {}, group_by: [], top_n: 10, then_draft: false, explanation: "Not supported.", fields_used: [], unsupported_reason: "Recoverly is read-only and never retries payments." });
    const llm = stubLlm({ json: [unsupported] });
    setLlmForTesting(llm);
    const { outcome, names } = await run({ runPython: ok(goldenStdout), question: "Retry all failed payments now" });
    expect(outcome).toMatchObject({ ok: false, code: "UNSUPPORTED_REQUEST", message: "Recoverly is read-only and never retries payments." });
    expect(names).toEqual(["plan"]);
    expect(llm.calls.text).toBe(0);
  });

  it("regenerates an invalid plan once, then gives up as UNSUPPORTED_REQUEST", async () => {
    const llm = stubLlm({ json: ["{}", "{\"intent\":\"magic\"}"] });
    setLlmForTesting(llm);
    expect((await run({ runPython: ok(goldenStdout) })).outcome).toMatchObject({ ok: false, code: "UNSUPPORTED_REQUEST" });
    expect(llm.calls.json).toBe(2);
  });

  it("reports LLM_UNAVAILABLE when the provider fails", async () => {
    setLlmForTesting(stubLlm({}));
    expect((await run({ runPython: ok(goldenStdout) })).outcome).toMatchObject({ ok: false, code: "LLM_UNAVAILABLE" });
  });

  it("tolerates a plan wrapped in prose and fences, with nulls", async () => {
    const messy = `Sure!\n\`\`\`json\n${JSON.stringify({ ...DEMO_PLAN, unsupported_reason: null, filters: { failed_within_days: 7, currency: null } })}\n\`\`\``;
    setLlmForTesting(stubLlm({ json: [messy], text: [fenced(replayScript)] }));
    expect((await run({ runPython: ok(goldenStdout) })).outcome.ok).toBe(true);
  });
});

describe("replay mode", () => {
  it("skips the LLM, labels the source, and runs through the same guard and validation", async () => {
    const llm = stubLlm({});
    setLlmForTesting(llm);
    const { outcome, events } = await run({ runPython: ok(goldenStdout), replay: true });
    expect(outcome.ok).toBe(true);
    expect(llm.calls.json + llm.calls.text).toBe(0);
    expect(events.find(([e]) => e === "plan")![1]).toMatchObject({ source: "replay" });
    expect(events.find(([e]) => e === "code")![1]).toMatchObject({ source: "replay" });
    expect(events.some(([e]) => e === "guard")).toBe(true);
  });

  it("does not retry and fails visibly when the saved script breaks", async () => {
    const runPython: RunPythonFn = async () => ({ status: "nonzero_exit", exitCode: 1, stdout: "", stderr: "boom", execMs: 1, sandboxId: "sb-1" });
    const { outcome } = await run({ runPython, replay: true });
    expect(outcome).toMatchObject({ ok: false, code: "SANDBOX_EXEC_FAILED" });
  });

  it("keeps the embedded replay plan identical to DEMO_PLAN", () => {
    const literal = /json\.loads\(r'''(.*?)'''\)/s.exec(replayScript)![1]!;
    expect(JSON.parse(literal)).toEqual(DEMO_PLAN);
  });
});
