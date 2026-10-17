import { NextResponse } from "next/server";
import { approveDraft } from "@/lib/drafting/service";
import { errorResponse, readJson, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ draftId: string }> }) {
  try {
    requireAccess(req);
    const { draftId } = await ctx.params;
    const body = await readJson(req);
    const result = await approveDraft(draftId, { nonce: body.nonce, confirm: body.confirm, editedBody: body.editedBody });
    if (result.status === "send_failed") {
      return NextResponse.json(
        { error: { code: "SEND_FAILED", message: "Delivery failed. The approved draft was preserved so you can retry." }, ...result },
        { status: 502 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
