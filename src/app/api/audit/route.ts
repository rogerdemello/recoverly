import { NextResponse } from "next/server";
import { listAudit } from "@/lib/drafting/service";
import { errorResponse, requireAccess } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    requireAccess(req);
    return NextResponse.json({ entries: listAudit() });
  } catch (err) {
    return errorResponse(err);
  }
}
