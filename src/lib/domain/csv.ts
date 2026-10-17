/**
 * CSV import: parse as data only (never eval), validate against technical-spec section 2, mask emails.
 */

export const MAX_ROWS = 5000;
export const MAX_BYTES = 1024 * 1024;
export const MAX_PROBLEMS = 20;

export const REQUIRED_COLUMNS = [
  "customer_id",
  "customer_email",
  "invoice_id",
  "subscription_id",
  "amount_due",
  "currency",
  "failure_code",
  "failure_message",
  "failed_at",
  "attempt_count",
  "next_payment_attempt",
  "invoice_status",
  "customer_created_at",
  "hosted_invoice_url",
] as const;

/** Columns that must exist in the header. The remaining ones are optional values but the column should be present. */
const MANDATORY_HEADER = [
  "customer_id",
  "invoice_id",
  "amount_due",
  "currency",
  "failure_code",
  "failed_at",
  "attempt_count",
  "next_payment_attempt",
  "invoice_status",
] as const;

const TEXT_COLUMNS = [
  "customer_id",
  "customer_email",
  "invoice_id",
  "subscription_id",
  "failure_code",
  "failure_message",
  "hosted_invoice_url",
] as const;

export interface DatasetRecord {
  customer_id: string;
  customer_email: string;
  invoice_id: string;
  subscription_id: string;
  amount_due: number;
  currency: string;
  failure_code: string;
  failure_message: string;
  failed_at: string;
  attempt_count: number;
  next_payment_attempt: string;
  invoice_status: "open" | "paid" | "uncollectible" | "void";
  customer_created_at: string;
  hosted_invoice_url: string;
}

export interface CsvProblem {
  row: number;
  column: string;
  problem: string;
}

export type CsvParseResult =
  | { ok: true; records: DatasetRecord[] }
  | { ok: false; problems: CsvProblem[] };

/** RFC 4180 tokenizer: quoted fields, escaped quotes, embedded commas and newlines. */
export function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Returns canonical `YYYY-MM-DDTHH:MM:SSZ` or null when the value is not a valid ISO-8601 timestamp. */
export function normalizeTimestamp(value: string): string | null {
  if (!ISO_TS.test(value)) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// 13 to 19 digits, optionally separated by single spaces or dashes (a PAN-like run).
const PAN_LIKE = /(?<![\d])\d(?:[ -]?\d){12,18}(?![\d])/;

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

export function parseCsv(text: string, byteLength = Buffer.byteLength(text, "utf8")): CsvParseResult {
  const problems: CsvProblem[] = [];
  const add = (row: number, column: string, problem: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ row, column, problem });
  };

  if (byteLength > MAX_BYTES) return { ok: false, problems: [{ row: 0, column: "*", problem: "too_large" }] };
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const table = tokenizeCsv(clean);
  if (table.length === 0) return { ok: false, problems: [{ row: 0, column: "*", problem: "empty_file" }] };

  const header = table[0]!.map((h) => h.trim());
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) return { ok: false, problems: [{ row: 0, column: "*", problem: "too_large" }] };

  const index = new Map<string, number>();
  header.forEach((name, i) => {
    if (!index.has(name)) index.set(name, i);
  });
  for (const col of MANDATORY_HEADER) {
    if (!index.has(col)) add(0, col, "missing_column");
  }
  if (problems.length) return { ok: false, problems };

  const records: DatasetRecord[] = [];
  const seenInvoices = new Set<string>();

  dataRows.forEach((cells, k) => {
    const rowNo = k + 1;
    const get = (col: string): string => {
      const i = index.get(col);
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };
    if (cells.length !== header.length) {
      add(rowNo, "*", "column_count_mismatch");
      return;
    }

    const customerId = get("customer_id");
    if (!/^[A-Za-z0-9_]{1,64}$/.test(customerId)) add(rowNo, "customer_id", "invalid_customer_id");

    const invoiceId = get("invoice_id");
    if (!invoiceId) add(rowNo, "invoice_id", "missing_value");
    else if (seenInvoices.has(invoiceId)) add(rowNo, "invoice_id", "duplicate_invoice_id");
    seenInvoices.add(invoiceId);

    const amountRaw = get("amount_due");
    let amount = 0;
    if (/^-\d+$/.test(amountRaw)) add(rowNo, "amount_due", "negative_amount");
    else if (!/^\d{1,15}$/.test(amountRaw)) add(rowNo, "amount_due", "not_integer");
    else amount = Number(amountRaw);

    const currency = get("currency");
    if (!/^[A-Za-z]{3}$/.test(currency)) add(rowNo, "currency", "invalid_currency");

    const failureCode = get("failure_code").toLowerCase();
    if (!failureCode) add(rowNo, "failure_code", "missing_value");
    else if (!/^[a-z0-9_]{1,64}$/.test(failureCode)) add(rowNo, "failure_code", "invalid_failure_code");

    const failedAtRaw = get("failed_at");
    const failedAt = normalizeTimestamp(failedAtRaw);
    if (!failedAt) add(rowNo, "failed_at", "invalid_timestamp");

    const attemptRaw = get("attempt_count");
    if (!/^\d{1,6}$/.test(attemptRaw)) add(rowNo, "attempt_count", "invalid_attempt_count");

    const npaRaw = get("next_payment_attempt");
    let npa = "";
    if (npaRaw === "unknown") npa = "unknown";
    else if (npaRaw !== "") {
      const normalized = normalizeTimestamp(npaRaw);
      if (!normalized) add(rowNo, "next_payment_attempt", "invalid_timestamp");
      else npa = normalized;
    }

    const status = get("invoice_status");
    if (!["open", "paid", "uncollectible", "void"].includes(status)) add(rowNo, "invoice_status", "invalid_status");

    const createdRaw = get("customer_created_at");
    let created = "";
    if (createdRaw !== "") {
      const normalized = normalizeTimestamp(createdRaw);
      if (!normalized) add(rowNo, "customer_created_at", "invalid_timestamp");
      else created = normalized;
    }

    for (const col of TEXT_COLUMNS) {
      if (PAN_LIKE.test(get(col))) add(rowNo, col, "possible_card_number"); // never echo the value
    }

    records.push({
      customer_id: customerId,
      customer_email: get("customer_email"),
      invoice_id: invoiceId,
      subscription_id: get("subscription_id"),
      amount_due: amount,
      currency: currency.toLowerCase(),
      failure_code: failureCode,
      failure_message: get("failure_message"),
      failed_at: failedAt ?? "",
      attempt_count: Number(attemptRaw) || 0,
      next_payment_attempt: npa,
      invoice_status: status as DatasetRecord["invoice_status"],
      customer_created_at: created,
      hosted_invoice_url: get("hosted_invoice_url"),
    });
  });

  if (problems.length) return { ok: false, problems };
  if (records.length === 0) return { ok: false, problems: [{ row: 0, column: "*", problem: "no_rows" }] };
  return { ok: true, records };
}

/** The only shape that reaches the sandbox: masked email, no extra columns (technical-spec 2.4). */
export function toSandboxData(asOf: string, records: DatasetRecord[]) {
  return {
    as_of: asOf,
    records: records.map((r) => ({
      customer_id: r.customer_id,
      customer_email_masked: maskEmail(r.customer_email),
      invoice_id: r.invoice_id,
      subscription_id: r.subscription_id,
      amount_due: r.amount_due,
      currency: r.currency,
      failure_code: r.failure_code,
      failure_message: r.failure_message,
      failed_at: r.failed_at,
      attempt_count: r.attempt_count,
      next_payment_attempt: r.next_payment_attempt,
      invoice_status: r.invoice_status,
      customer_created_at: r.customer_created_at,
      hosted_invoice_url: r.hosted_invoice_url,
    })),
  };
}
