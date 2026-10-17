import { runPipeline } from "@/lib/agent/pipeline";
import { MAX_QUESTION_CHARS } from "@/lib/agent/plan";
import { ApiError, enforceAnalysisRateLimit, errorBody, errorResponse, readJson, requireAccess, statusFor } from "@/lib/http";
import { getDataset, newAnalysisId, saveAnalysis } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Streams the pipeline as Server-Sent Events: plan, code, guard, sandbox, result | error, then done. */
export async function POST(req: Request) {
  let datasetId: string;
  let question: string;
  let replay: boolean;
  try {
    requireAccess(req);
    const body = await readJson(req);
    if (typeof body.datasetId !== "string" || !body.datasetId) throw new ApiError("BAD_REQUEST", "datasetId is required.");
    if (typeof body.question !== "string" || !body.question.trim()) throw new ApiError("BAD_REQUEST", "Ask a question first.");
    if (body.question.length > MAX_QUESTION_CHARS) throw new ApiError("BAD_REQUEST", `Questions are limited to ${MAX_QUESTION_CHARS} characters.`);
    datasetId = body.datasetId;
    question = body.question.trim();
    replay = body.replay === true;
    if (!getDataset(datasetId)) throw new ApiError("DATASET_NOT_FOUND", "That dataset is no longer loaded. Load the data again.");
    enforceAnalysisRateLimit(req);
  } catch (err) {
    return errorResponse(err);
  }

  const dataset = getDataset(datasetId)!;
  const analysisId = newAnalysisId();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false; // client went away
        }
      };
      try {
        const outcome = await runPipeline({
          dataset,
          question,
          analysisId,
          replay,
          emit: (event, data) => {
            if (event === "result") {
              // Store before the client can see the result, so a draft request cannot race it.
              saveAnalysis({ analysisId, datasetId, question, result: (data as { result: never }).result });
            }
            send(event, data);
          },
        });
        if (!outcome.ok) {
          send("error", { code: outcome.code, message: outcome.message, status: statusFor(outcome.code), details: outcome.details });
        }
      } catch (err) {
        console.error("[analyze] pipeline crashed:", err instanceof Error ? err.name : "unknown");
        send("error", errorBody("GENERATION_FAILED", "The analysis failed unexpectedly.").error);
      } finally {
        send("done", {});
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
