import { NextResponse } from "next/server";
import { MAX_BYTES, parseCsv } from "@/lib/domain/csv";
import { ApiError, errorBody, errorResponse, requireAccess } from "@/lib/http";
import { loadFixtureDataset, saveUploadedDataset, summarizeDataset } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Loads the bundled synthetic fixture (JSON body {source:"fixture"}) or an uploaded CSV (multipart `file`). */
export async function POST(req: Request) {
  try {
    requireAccess(req);
    const type = req.headers.get("content-type") ?? "";

    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError("BAD_REQUEST", "Attach the CSV as a form field named \"file\".");
      if (file.size > MAX_BYTES) {
        return NextResponse.json(errorBody("CSV_INVALID", "The file is larger than 1 MB.", [{ row: 0, column: "*", problem: "too_large" }]), { status: 400 });
      }
      const text = await file.text();
      const parsed = parseCsv(text, file.size);
      if (!parsed.ok) {
        return NextResponse.json(errorBody("CSV_INVALID", "The CSV could not be imported. Nothing was loaded.", parsed.problems), { status: 400 });
      }
      return NextResponse.json(summarizeDataset(saveUploadedDataset(parsed.records)));
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError("BAD_REQUEST", "Send {\"source\":\"fixture\"} or a multipart CSV upload.");
    }
    if ((body as { source?: unknown } | null)?.source !== "fixture") {
      throw new ApiError("BAD_REQUEST", "Send {\"source\":\"fixture\"} or a multipart CSV upload.");
    }
    return NextResponse.json(summarizeDataset(loadFixtureDataset()));
  } catch (err) {
    return errorResponse(err);
  }
}
