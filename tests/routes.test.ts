import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLlmForTesting } from "../src/lib/agent/llm";
import { DEMO_PLAN, DEMO_QUESTION } from "../src/lib/domain/schemas";
import { resetStoreForTests } from "../src/lib/store";
import { golden } from "./helpers";

const goldenStdout = JSON.stringify(golden("golden-b"));
const replayScript = readFileSync(path.join(process.cwd(), "sandbox", "replay", "rank_recoverable.py"), "utf8");

const runPythonMock = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/sandbox/runner", () => ({ runPython: runPythonMock }));

import { GET as healthGET } from "../src/app/api/health/route";
import { POST as loadPOST } from "../src/app/api/data/load/route";
import { POST as analyzePOST } from "../src/app/api/analyze/route";
import { POST as draftPOST } from "../src/app/api/draft/route";
import { POST as approvePOST } from "../src/app/api/draft/[draftId]/approve/route";
import { GET as auditGET } from "../src/app/api/audit/route";

const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function readSse(res: Response): Promise<Array<{ event: string; data: any }>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)![1]!;
      const data = JSON.parse(/^data: (.*)$/m.exec(block)![1]!);
      return { event, data };
    });
}

beforeEach(() => {
  resetStoreForTests();
  runPythonMock.mockReset();
  runPythonMock.mockResolvedValue({ status: "ok", exitCode: 0, stdout: goldenStdout, stderr: "", execMs: 70, sandboxId: "sb-abcdef123456" });
  setLlmForTesting({
    json: async () => JSON.stringify(DEMO_PLAN),
    text: async () => `\`\`\`python\n${replayScript}\n\`\`\``,
  });
});
afterEach(() => {
  setLlmForTesting(null);
  delete process.env.RECOVERLY_ACCESS_CODE;
});

describe("GET /api/health", () => {
  it("reports booleans only", async () => {
    const body = await healthGET().json();
    expect(body).toMatchObject({ ok: true, app: "recoverly" });
    expect(Object.values(body.config).every((v) => typeof v === "boolean")).toBe(true);
  });
});

describe("POST /api/data/load", () => {
  it("loads the fixture", async () => {
    const res = await loadPOST(json("/api/data/load", { source: "fixture" }));
    expect(await res.json()).toMatchObject({ datasetId: "fixture", source: "fixture", synthetic: true, rows: 13, currencies: ["usd", "eur"], asOf: "2026-10-17T12:00:00Z" });
  });

  it("imports an uploaded CSV and flags it as not synthetic", async () => {
    const csv = readFileSync(path.join(process.cwd(), "data", "fixtures", "failed_payments.csv"));
    const form = new FormData();
    form.append("file", new File([csv], "payments.csv", { type: "text/csv" }));
    const res = await loadPOST(new Request("http://localhost/api/data/load", { method: "POST", body: form }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ source: "upload", synthetic: false, rows: 13 });
    expect(body.datasetId).toMatch(/^ds_/);
  });

  it("rejects an invalid CSV with row/column details", async () => {
    const form = new FormData();
    form.append("file", new File(["customer_id,invoice_id\ncus_1,in_1"], "bad.csv"));
    const res = await loadPOST(new Request("http://localhost/api/data/load", { method: "POST", body: form }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("CSV_INVALID");
    expect(body.error.details[0]).toMatchObject({ problem: "missing_column" });
  });

  it("rejects an unknown source", async () => {
    const res = await loadPOST(json("/api/data/load", { source: "stripe-live" }));
    expect(res.status).toBe(400);
  });

  it("requires the access code when one is configured", async () => {
    process.env.RECOVERLY_ACCESS_CODE = "open-sesame";
    expect((await loadPOST(json("/api/data/load", { source: "fixture" }))).status).toBe(401);
    expect((await loadPOST(json("/api/data/load", { source: "fixture" }, { "x-access-code": "open-sesame" }))).status).toBe(200);
  });
});

describe("POST /api/analyze", () => {
  it("validates the request before streaming", async () => {
    expect((await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: "" }))).status).toBe(400);
    expect((await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: "x".repeat(501) }))).status).toBe(400);
    const missing = await analyzePOST(json("/api/analyze", { datasetId: "ds_nope", question: "hi" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("DATASET_NOT_FOUND");
  });

  it("streams plan, code, guard, sandbox, result, done and stores the analysis", async () => {
    const res = await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: DEMO_QUESTION }, { "x-forwarded-for": "9.9.9.1" }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(["plan", "code", "guard", "sandbox", "result", "done"]);
    const result = events.find((e) => e.event === "result")!.data;
    expect(result.result.queues[0].items[0].invoice_id).toBe("in_synth_001");
    expect(JSON.stringify(events)).not.toContain("ava.stone@example.test");
    const analysisId = result.analysisId as string;

    // The stored analysis supports drafting and approval end to end.
    const draftRes = await draftPOST(json("/api/draft", { analysisId, invoiceId: "in_synth_001", tone: "concise" }));
    const draft = await draftRes.json();
    expect(draftRes.status).toBe(200);
    expect(draft.toMasked).toBe("a***@example.test");
    const approveRes = await approvePOST(json("/x", { nonce: draft.approval.nonce, confirm: true }), { params: Promise.resolve({ draftId: draft.draftId }) });
    expect(await approveRes.json()).toMatchObject({ status: "approved_not_sent" });
    const audit = await (await auditGET(new Request("http://localhost/api/audit"))).json();
    expect(audit.entries.map((e: { action: string }) => e.action)).toEqual(["draft_approved", "draft_generated"]);
  });

  it("emits a visible error event when the sandbox output is malformed", async () => {
    runPythonMock.mockResolvedValue({ status: "ok", exitCode: 0, stdout: "garbage", stderr: "", execMs: 1, sandboxId: "sb-1" });
    const events = await readSse(await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: DEMO_QUESTION }, { "x-forwarded-for": "9.9.9.2" })));
    expect(events.map((e) => e.event)).not.toContain("result");
    expect(events.find((e) => e.event === "error")!.data).toMatchObject({ code: "RESULT_INVALID" });
    expect(events.at(-1)!.event).toBe("done");
  });

  it("emits UNSUPPORTED_REQUEST after the plan and runs no code", async () => {
    setLlmForTesting({
      json: async () => JSON.stringify({ intent: "unsupported", filters: {}, group_by: [], top_n: 10, then_draft: false, explanation: "Not supported.", fields_used: [], unsupported_reason: "Read-only tool." }),
      text: async () => "",
    });
    const events = await readSse(await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: "Retry everything" }, { "x-forwarded-for": "9.9.9.3" })));
    expect(events.map((e) => e.event)).toEqual(["plan", "error", "done"]);
    expect(events[1]!.data).toMatchObject({ code: "UNSUPPORTED_REQUEST", message: "Read-only tool." });
    expect(runPythonMock).not.toHaveBeenCalled();
  });

  it("supports replay without calling the LLM", async () => {
    setLlmForTesting({ json: async () => { throw new Error("must not be called"); }, text: async () => { throw new Error("must not be called"); } });
    const events = await readSse(await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: "anything", replay: true }, { "x-forwarded-for": "9.9.9.4" })));
    expect(events.map((e) => e.event)).toEqual(["plan", "code", "guard", "sandbox", "result", "done"]);
    expect(events[1]!.data.source).toBe("replay");
  });

  it("rate limits after 20 analyses per IP", async () => {
    const headers = { "x-forwarded-for": "9.9.9.9" };
    for (let i = 0; i < 20; i++) {
      const res = await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: "q", replay: true }, headers));
      await res.text();
    }
    const blocked = await analyzePOST(json("/api/analyze", { datasetId: "fixture", question: "q", replay: true }, headers));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
  });
});

describe("draft and approve routes", () => {
  it("validate their input", async () => {
    expect((await draftPOST(json("/api/draft", { analysisId: "x" }))).status).toBe(400);
    expect((await draftPOST(json("/api/draft", { analysisId: "x", invoiceId: "y", tone: "angry" }))).status).toBe(400);
    expect((await draftPOST(json("/api/draft", { analysisId: "x", invoiceId: "y", tone: "concise" }))).status).toBe(404);
    const res = await approvePOST(json("/x", { nonce: "a", confirm: true }), { params: Promise.resolve({ draftId: "dr_nope" }) });
    expect(res.status).toBe(404);
  });
});
