// ---------------------------------------------------------------------------
// CSV column-mapping engine (manual import, acquisition channel #2).
//
// The dashboard renders a mapping UI; ALL parsing/normalisation lives here.
// Unlike the auto-detecting parseCSV(), this path is explicit and fail-closed:
//   * the caller states which columns mean what, the date format, and the sign
//     convention — we never guess;
//   * an ambiguous or incomplete mapping is rejected, not patched over;
//   * malformed data rows are SURFACED as errors, never silently dropped.
//
// Output rows are channel-neutral; the engine turns them into the same
// ProviderBankTransaction shape the Plaid feed produces.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { normalizeAmount } from "./csv-parser.js";

// ---------------------------------------------------------------------------
// Mapping schema
// ---------------------------------------------------------------------------

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Which sign in a single signed amount column means money leaving the account. */
export type SignConvention = "negative_is_outflow" | "positive_is_outflow";

export type AmountMode = "signed" | "debit_credit";

export const csvMappingSchema = z
  .object({
    hasHeader: z.boolean().default(true),
    dateColumn: z.number().int().min(0),
    dateFormat: z.enum(DATE_FORMATS).default("DD/MM/YYYY"),
    descriptionColumn: z.number().int().min(0),

    amountMode: z.enum(["signed", "debit_credit"]),
    // signed mode
    amountColumn: z.number().int().min(0).optional(),
    signConvention: z.enum(["negative_is_outflow", "positive_is_outflow"]).optional(),
    // debit/credit split mode
    debitColumn: z.number().int().min(0).optional(),
    creditColumn: z.number().int().min(0).optional(),

    // optional fields
    referenceColumn: z.number().int().min(0).nullable().optional(),
    balanceColumn: z.number().int().min(0).nullable().optional(),
    currencyColumn: z.number().int().min(0).nullable().optional(),
    currency: z.string().length(3).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.amountMode === "signed") {
      if (m.amountColumn === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["amountColumn"], message: "amountColumn is required in signed mode" });
      }
      if (m.signConvention === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["signConvention"], message: "signConvention is required in signed mode" });
      }
    } else {
      if (m.debitColumn === undefined && m.creditColumn === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["debitColumn"], message: "debit_credit mode requires debitColumn and/or creditColumn" });
      }
    }
  });

export type CsvMapping = z.infer<typeof csvMappingSchema>;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface MappedRow {
  readonly date: string; // ISO YYYY-MM-DD
  readonly amount: number; // positive integer, smallest currency unit
  readonly type: "credit" | "debit";
  readonly description: string;
  readonly reference: string | null;
  readonly balance: number | null;
  readonly currency: string;
  readonly rawData: Record<string, unknown>;
}

export interface RowError {
  readonly rowIndex: number; // 0-based index into data rows (excludes header)
  readonly raw: readonly string[];
  readonly reason: string;
}

export interface MappingResult {
  readonly rows: readonly MappedRow[];
  readonly errors: readonly RowError[];
  readonly headers: readonly string[];
  readonly totalDataRows: number;
}

/** A saved, reusable per-bank column mapping. */
export interface MappingProfile {
  readonly id: string;
  readonly ledgerId: string;
  readonly name: string;
  readonly mapping: CsvMapping;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A preview row: a mapped row annotated with whether it duplicates an existing one. */
export interface CsvImportPreviewRow extends MappedRow {
  readonly isDuplicate: boolean;
}

/** Dry-run preview of a CSV import — no writes performed. */
export interface CsvImportPreview {
  readonly rows: readonly CsvImportPreviewRow[];
  readonly errors: readonly RowError[];
  readonly headers: readonly string[];
  readonly newCount: number;
  readonly duplicateCount: number;
  readonly errorCount: number;
  readonly totalDataRows: number;
}

/** Result of committing a CSV import. */
export interface CsvImportResult {
  readonly bankAccountId: string;
  readonly imported: number;
  readonly duplicates: number;
  readonly errors: readonly RowError[];
  readonly matched: number;
}

// ---------------------------------------------------------------------------
// Tokenizer — quoted fields, escaped quotes, CRLF/LF, BOM. Preserves every
// physical row (we do NOT drop blanks here) so positions stay meaningful for
// error reporting.
// ---------------------------------------------------------------------------

export function tokenizeCsv(content: string): string[][] {
  const stripped = content.replace(/^﻿/, ""); // drop BOM
  const normalized = stripped.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field.trim());
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < normalized.length) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      pushField();
      i++;
    } else if (ch === "\n") {
      pushRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  // Flush trailing field/row unless the input ended exactly on a newline.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Date parsing — STRICT to the chosen format (no guessing).
// ---------------------------------------------------------------------------

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Parse a date string strictly against the mapping's format. Throws on mismatch. */
export function parseDateStrict(raw: string, format: DateFormat): string {
  const s = raw.trim();
  if (format === "YYYY-MM-DD") {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error(`expected YYYY-MM-DD, got "${raw}"`);
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!isValidYmd(y, mo, d)) throw new Error(`invalid date "${raw}"`);
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (format === "DD-MMM-YYYY") {
    const m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{4})$/);
    if (!m) throw new Error(`expected DD-MMM-YYYY, got "${raw}"`);
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (!mo) throw new Error(`unknown month "${m[2]}" in "${raw}"`);
    const d = Number(m[1]);
    const y = Number(m[3]);
    if (!isValidYmd(y, Number(mo), d)) throw new Error(`invalid date "${raw}"`);
    return `${m[3]}-${mo}-${String(d).padStart(2, "0")}`;
  }
  // DD/MM/YYYY or MM/DD/YYYY (also accept '-' separators)
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) throw new Error(`expected ${format}, got "${raw}"`);
  const first = Number(m[1]);
  const second = Number(m[2]);
  const y = Number(m[3]);
  const day = format === "DD/MM/YYYY" ? first : second;
  const month = format === "DD/MM/YYYY" ? second : first;
  if (!isValidYmd(y, month, day)) throw new Error(`invalid date "${raw}" for format ${format}`);
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Apply a validated mapping to tokenized rows.
// ---------------------------------------------------------------------------

function cell(row: readonly string[], idx: number | null | undefined): string | null {
  if (idx === null || idx === undefined) return null;
  const v = row[idx];
  return v === undefined ? null : v;
}

/**
 * Apply a mapping to raw CSV content. Returns mapped rows plus a list of row
 * errors (malformed rows are surfaced, never dropped). Throws only if the
 * mapping itself is invalid/ambiguous (fail-closed).
 */
export function applyMapping(content: string, mappingInput: CsvMapping): MappingResult {
  const mapping = csvMappingSchema.parse(mappingInput); // fail-closed on bad mapping

  const all = tokenizeCsv(content);
  if (all.length === 0) {
    return { rows: [], errors: [], headers: [], totalDataRows: 0 };
  }

  const hasHeader = mapping.hasHeader ?? true;
  const headers = hasHeader ? all[0]!.map((h) => h) : [];
  const dataRows = hasHeader ? all.slice(1) : all;

  const rows: MappedRow[] = [];
  const errors: RowError[] = [];

  dataRows.forEach((raw, rowIndex) => {
    // Skip genuinely empty lines (all cells blank) without flagging them.
    if (raw.every((c) => c.trim() === "")) return;

    try {
      const dateRaw = cell(raw, mapping.dateColumn);
      if (!dateRaw) throw new Error("missing date");
      const date = parseDateStrict(dateRaw, mapping.dateFormat);

      const description = (cell(raw, mapping.descriptionColumn) ?? "").trim();
      if (!description) throw new Error("missing description");

      const currency =
        (mapping.currencyColumn != null ? cell(raw, mapping.currencyColumn)?.trim() : null) ||
        mapping.currency ||
        "AUD";

      const { amount, type } = parseAmount(raw, mapping, currency);

      const balanceRaw = mapping.balanceColumn != null ? cell(raw, mapping.balanceColumn) : null;
      const balance =
        balanceRaw && balanceRaw.trim() !== "" ? normalizeAmount(balanceRaw, currency) : null;

      const referenceRaw = mapping.referenceColumn != null ? cell(raw, mapping.referenceColumn) : null;
      const reference = referenceRaw && referenceRaw.trim() !== "" ? referenceRaw.trim() : null;

      const rawData: Record<string, unknown> = {};
      raw.forEach((value, i) => {
        const key = headers[i] ?? `col_${i}`;
        rawData[key] = value;
      });

      rows.push({ date, amount, type, description, reference, balance, currency, rawData });
    } catch (e) {
      errors.push({
        rowIndex,
        raw,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return { rows, errors, headers, totalDataRows: dataRows.filter((r) => !r.every((c) => c.trim() === "")).length };
}

function parseAmount(
  raw: readonly string[],
  mapping: CsvMapping,
  currency: string,
): { amount: number; type: "credit" | "debit" } {
  if (mapping.amountMode === "signed") {
    const amountRaw = cell(raw, mapping.amountColumn!);
    if (!amountRaw || amountRaw.trim() === "") throw new Error("missing amount");
    const signed = normalizeAmount(amountRaw, currency);
    if (signed === 0) throw new Error("zero amount");
    const isOutflow =
      mapping.signConvention === "negative_is_outflow" ? signed < 0 : signed > 0;
    return { amount: Math.abs(signed), type: isOutflow ? "debit" : "credit" };
  }

  // debit_credit mode: exactly one of the two columns must be populated.
  const debitRaw = mapping.debitColumn != null ? cell(raw, mapping.debitColumn) : null;
  const creditRaw = mapping.creditColumn != null ? cell(raw, mapping.creditColumn) : null;
  const hasDebit = debitRaw != null && debitRaw.trim() !== "";
  const hasCredit = creditRaw != null && creditRaw.trim() !== "";

  if (hasDebit && hasCredit) throw new Error("both debit and credit populated (ambiguous)");
  if (!hasDebit && !hasCredit) throw new Error("neither debit nor credit populated");

  if (hasDebit) {
    const amt = Math.abs(normalizeAmount(debitRaw!, currency));
    if (amt === 0) throw new Error("zero amount");
    return { amount: amt, type: "debit" };
  }
  const amt = Math.abs(normalizeAmount(creditRaw!, currency));
  if (amt === 0) throw new Error("zero amount");
  return { amount: amt, type: "credit" };
}
