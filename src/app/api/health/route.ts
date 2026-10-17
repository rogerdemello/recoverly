import { NextResponse } from "next/server";
import { configStatus } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Deployment smoke check: reports which integrations are configured, never their values. */
export function GET() {
  return NextResponse.json({ ok: true, app: "recoverly", config: configStatus() });
}
