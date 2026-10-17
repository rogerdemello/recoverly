/**
 * In-memory server state, keyed by random ids, kept on globalThis so Next.js hot reloads keep it.
 * Assumes a long-lived Node server; the fixture dataset is rebuilt statelessly from the bundled CSV.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, type DatasetRecord } from "./domain/csv";
import type { AnalysisResult, AuditEntry, DatasetSummary, Tone } from "./domain/schemas";

export const FIXTURE_AS_OF = "2026-10-17T12:00:00Z";
export const FIXTURE_ID = "fixture";

export interface Dataset {
  datasetId: string;
  source: "fixture" | "upload";
  synthetic: boolean;
  asOf: string;
  records: DatasetRecord[];
}

export interface StoredAnalysis {
  analysisId: string;
  datasetId: string;
  question: string;
  result: AnalysisResult;
  createdAt: number;
}

export interface StoredDraft {
  draftId: string;
  analysisId: string;
  invoiceId: string;
  customerId: string;
  toRaw: string;
  toMasked: string;
  subject: string;
  body: string;
  tone: Tone;
  source: "llm" | "template";
  nonce: string;
  expiresAt: number;
  used: boolean;
  /** Context needed to re-run the content checks on an edited body. */
  context: { amount: string; hostedInvoiceUrl: string; failureCode: string; failureMessage: string; score: string; support: string };
  approved?: { subject: string; body: string; status: string };
}

interface StoreGlobals {
  datasets: Map<string, Dataset>;
  analyses: Map<string, StoredAnalysis>;
  drafts: Map<string, StoredDraft>;
  audit: AuditEntry[];
  hits: Map<string, number[]>;
}

const g = globalThis as unknown as { __recoverlyStore?: StoreGlobals };
const store: StoreGlobals = (g.__recoverlyStore ??= {
  datasets: new Map(),
  analyses: new Map(),
  drafts: new Map(),
  audit: [],
  hits: new Map(),
});

function capMap<V>(map: Map<string, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function fixtureCsvPath(): string {
  return path.join(process.cwd(), "data", "fixtures", "failed_payments.csv");
}

export function loadFixtureDataset(): Dataset {
  const parsed = parseCsv(readFileSync(fixtureCsvPath(), "utf8"));
  if (!parsed.ok) throw new Error(`Bundled fixture is invalid: ${JSON.stringify(parsed.problems)}`);
  return { datasetId: FIXTURE_ID, source: "fixture", synthetic: true, asOf: FIXTURE_AS_OF, records: parsed.records };
}

export function saveUploadedDataset(records: DatasetRecord[], now = new Date()): Dataset {
  const dataset: Dataset = {
    datasetId: `ds_${randomUUID().slice(0, 12)}`,
    source: "upload",
    synthetic: false,
    asOf: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    records,
  };
  store.datasets.set(dataset.datasetId, dataset);
  capMap(store.datasets, 20);
  return dataset;
}

export function getDataset(id: string): Dataset | undefined {
  if (id === FIXTURE_ID) return loadFixtureDataset();
  return store.datasets.get(id);
}

export function summarizeDataset(dataset: Dataset): DatasetSummary {
  const currencies: string[] = [];
  for (const r of dataset.records) if (!currencies.includes(r.currency)) currencies.push(r.currency);
  const warnings: string[] = [];
  if (dataset.synthetic) warnings.push("Synthetic demo data: no real customers, cards or Stripe objects.");
  return {
    datasetId: dataset.datasetId,
    source: dataset.source,
    synthetic: dataset.synthetic,
    asOf: dataset.asOf,
    rows: dataset.records.length,
    currencies,
    warnings,
  };
}

export function saveAnalysis(entry: Omit<StoredAnalysis, "analysisId" | "createdAt"> & { analysisId?: string }): StoredAnalysis {
  const stored: StoredAnalysis = { ...entry, analysisId: entry.analysisId ?? `an_${randomUUID().slice(0, 12)}`, createdAt: Date.now() };
  store.analyses.set(stored.analysisId, stored);
  capMap(store.analyses, 50);
  return stored;
}

export function getAnalysis(id: string): StoredAnalysis | undefined {
  return store.analyses.get(id);
}

export function newAnalysisId(): string {
  return `an_${randomUUID().slice(0, 12)}`;
}

export function saveDraft(draft: StoredDraft): void {
  store.drafts.set(draft.draftId, draft);
  capMap(store.drafts, 200);
}

export function getDraft(id: string): StoredDraft | undefined {
  return store.drafts.get(id);
}

export function auditLog(): AuditEntry[] {
  return store.audit;
}

/** Sliding-window limiter: `limit` hits per `windowMs` per key. Returns retry-after seconds when blocked. */
export function rateLimit(key: string, limit = 20, windowMs = 60 * 60 * 1000, now = Date.now()): number | null {
  const recent = (store.hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    store.hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
  }
  recent.push(now);
  store.hits.set(key, recent);
  capMap(store.hits, 5000);
  return null;
}

export function resetStoreForTests(): void {
  store.datasets.clear();
  store.analyses.clear();
  store.drafts.clear();
  store.audit.length = 0;
  store.hits.clear();
}
