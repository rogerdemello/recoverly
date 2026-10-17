import { NextResponse } from "next/server";
import { TONES, type Tone } from "@/lib/domain/schemas";
import { createDraft } from "@/lib/drafting/service";
import { ApiError, errorResponse, readJson, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    requireAccess(req);
    const body = await readJson(req);
    const { analysisId, invoiceId, tone } = body;
    if (typeof analysisId !== "string" || typeof invoiceId !== "string") {
      throw new ApiError("BAD_REQUEST", "analysisId and invoiceId are required.");
    }
    if (typeof tone !== "string" || !TONES.includes(tone as Tone)) {
      throw new ApiError("BAD_REQUEST", "tone must be concise, friendly or professional.");
    }
    return NextResponse.json(await createDraft(analysisId, invoiceId, tone as Tone));
  } catch (err) {
    return errorResponse(err);
  }
}
