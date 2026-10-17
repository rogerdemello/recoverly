import { readFileSync } from "node:fs";
import path from "node:path";
import type { AnalysisResult } from "../src/lib/domain/schemas";

export function golden(name: "golden-a" | "golden-b"): AnalysisResult {
  return JSON.parse(readFileSync(path.join(process.cwd(), "tests", "fixtures", `${name}.json`), "utf8")) as AnalysisResult;
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
