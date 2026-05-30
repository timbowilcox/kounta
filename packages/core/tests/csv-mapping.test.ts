// ---------------------------------------------------------------------------
// CSV mapping engine — strict, fail-closed parsing with surfaced errors.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { applyMapping, parseDateStrict } from "../src/import/csv-mapping.js";
import type { CsvMapping } from "../src/import/csv-mapping.js";

const signedMapping = (over: Partial<CsvMapping> = {}): CsvMapping =>
  ({
    hasHeader: true,
    dateColumn: 0,
    dateFormat: "DD/MM/YYYY",
    descriptionColumn: 1,
    amountMode: "signed",
    amountColumn: 2,
    signConvention: "negative_is_outflow",
    ...over,
  }) as CsvMapping;

describe("parseDateStrict — no guessing", () => {
  it("parses DD/MM/YYYY", () => {
    expect(parseDateStrict("25/01/2026", "DD/MM/YYYY")).toBe("2026-01-25");
    expect(parseDateStrict("13/02/2026", "DD/MM/YYYY")).toBe("2026-02-13");
  });
  it("parses MM/DD/YYYY differently from DD/MM/YYYY for the same string", () => {
    expect(parseDateStrict("01/02/2026", "DD/MM/YYYY")).toBe("2026-02-01");
    expect(parseDateStrict("01/02/2026", "MM/DD/YYYY")).toBe("2026-01-02");
  });
  it("parses YYYY-MM-DD and DD-MMM-YYYY", () => {
    expect(parseDateStrict("2026-03-09", "YYYY-MM-DD")).toBe("2026-03-09");
    expect(parseDateStrict("09-Mar-2026", "DD-MMM-YYYY")).toBe("2026-03-09");
  });
  it("rejects a string that does not match the chosen format", () => {
    expect(() => parseDateStrict("2026-03-09", "DD/MM/YYYY")).toThrow();
    expect(() => parseDateStrict("32/01/2026", "DD/MM/YYYY")).toThrow();
  });
});

describe("applyMapping — signed amount + sign convention", () => {
  it("negative_is_outflow: negative => debit, positive => credit", () => {
    const csv = ["date,desc,amount", "01/04/2026,Coffee,-5.50", "02/04/2026,Invoice,1200.00"].join("\n");
    const { rows, errors } = applyMapping(csv, signedMapping());
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ date: "2026-04-01", amount: 550, type: "debit", description: "Coffee" });
    expect(rows[1]).toMatchObject({ date: "2026-04-02", amount: 120000, type: "credit" });
  });

  it("positive_is_outflow flips the interpretation", () => {
    const csv = ["date,desc,amount", "01/04/2026,Coffee,5.50"].join("\n");
    const { rows } = applyMapping(csv, signedMapping({ signConvention: "positive_is_outflow" }));
    expect(rows[0]).toMatchObject({ amount: 550, type: "debit" });
  });
});

describe("applyMapping — debit/credit split", () => {
  const dcMapping: CsvMapping = {
    hasHeader: true,
    dateColumn: 0,
    dateFormat: "DD/MM/YYYY",
    descriptionColumn: 1,
    amountMode: "debit_credit",
    debitColumn: 2,
    creditColumn: 3,
  } as CsvMapping;

  it("routes debit and credit columns to the right type", () => {
    const csv = [
      "date,desc,debit,credit",
      "01/04/2026,Rent,2000.00,",
      "02/04/2026,Sale,,500.00",
    ].join("\n");
    const { rows, errors } = applyMapping(csv, dcMapping);
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ type: "debit", amount: 200000 });
    expect(rows[1]).toMatchObject({ type: "credit", amount: 50000 });
  });

  it("surfaces ambiguous rows (both columns populated) as errors, does not drop them", () => {
    const csv = ["date,desc,debit,credit", "01/04/2026,Weird,10.00,20.00"].join("\n");
    const { rows, errors } = applyMapping(csv, dcMapping);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.reason).toMatch(/ambiguous/i);
  });
});

describe("applyMapping — malformed rows are surfaced, never silently dropped", () => {
  it("collects per-row errors while still parsing the good rows", () => {
    const csv = [
      "date,desc,amount",
      "01/04/2026,Good,10.00",
      "not-a-date,Bad date,10.00",
      "03/04/2026,,10.00", // missing description
      "04/04/2026,No amount,",
      "05/04/2026,Good2,-20.00",
    ].join("\n");
    const { rows, errors } = applyMapping(csv, signedMapping());
    expect(rows.map((r) => r.description)).toEqual(["Good", "Good2"]);
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.rowIndex)).toEqual([1, 2, 3]);
  });

  it("ignores genuinely blank lines without flagging them", () => {
    const csv = ["date,desc,amount", "01/04/2026,Good,10.00", "", "  ,  ,  "].join("\n");
    const { rows, errors } = applyMapping(csv, signedMapping());
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
});

describe("applyMapping — fail-closed on ambiguous/incomplete mapping", () => {
  it("throws when signed mode lacks signConvention", () => {
    const bad = { hasHeader: true, dateColumn: 0, dateFormat: "DD/MM/YYYY", descriptionColumn: 1, amountMode: "signed", amountColumn: 2 } as CsvMapping;
    expect(() => applyMapping("date,desc,amount\n01/04/2026,X,1.00", bad)).toThrow();
  });
  it("throws when debit_credit mode maps neither column", () => {
    const bad = { hasHeader: true, dateColumn: 0, dateFormat: "DD/MM/YYYY", descriptionColumn: 1, amountMode: "debit_credit" } as CsvMapping;
    expect(() => applyMapping("date,desc\n01/04/2026,X", bad)).toThrow();
  });
});

describe("applyMapping — defensive parsing", () => {
  it("handles quoted fields with commas and strips a BOM", () => {
    const csv = '﻿date,desc,amount\n01/04/2026,"Smith, John",-9.99';
    const { rows, errors, headers } = applyMapping(csv, signedMapping());
    expect(errors).toHaveLength(0);
    expect(headers[0]).toBe("date"); // BOM stripped
    expect(rows[0]!.description).toBe("Smith, John");
  });

  it("keys rawData by header and falls back to the per-mapping currency", () => {
    const csv = "date,desc,amount\n01/04/2026,Coffee,-5.50";
    const { rows } = applyMapping(csv, signedMapping({ currency: "USD" }));
    expect(rows[0]!.currency).toBe("USD");
    expect(rows[0]!.rawData).toMatchObject({ date: "01/04/2026", desc: "Coffee", amount: "-5.50" });
  });
});
