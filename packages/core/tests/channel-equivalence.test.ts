// ---------------------------------------------------------------------------
// Shared acceptance criterion: both acquisition channels produce IDENTICAL
// internal transaction records for equivalent input. This is what makes
// cross-channel dedup possible — if the two channels disagreed on date,
// amount, type, or normalised description, the fingerprints would not collide.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalizePlaidTransaction, fingerprintOf } from "../src/bank-feeds/normalize.js";
import { applyMapping } from "../src/import/csv-mapping.js";
import type { CsvMapping } from "../src/import/csv-mapping.js";
import { lineFingerprint } from "../src/bank-feeds/normalize.js";
import type { PlaidTransaction } from "../src/bank-feeds/plaid-types.js";

const SIGNED_MAPPING: CsvMapping = {
  hasHeader: true,
  dateColumn: 0,
  dateFormat: "DD/MM/YYYY",
  descriptionColumn: 1,
  amountMode: "signed",
  amountColumn: 2,
  signConvention: "negative_is_outflow",
} as CsvMapping;

describe("channel equivalence", () => {
  it("a debit reaches the same canonical record from Plaid and from CSV", () => {
    const plaid: PlaidTransaction = {
      transaction_id: "px",
      account_id: "ax",
      amount: 89.95, // Plaid positive = money out
      iso_currency_code: "AUD",
      date: "2026-04-04",
      name: "OFFICEWORKS 0123",
      merchant_name: "Officeworks",
      pending: false,
      personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "X" },
    };
    const fromPlaid = normalizePlaidTransaction(plaid);

    const { rows } = applyMapping(
      "date,desc,amount\n04/04/2026,OFFICEWORKS 0123,-89.95",
      SIGNED_MAPPING,
    );
    const fromCsv = rows[0]!;

    // Canonical fields agree.
    expect(fromCsv.date).toBe(fromPlaid.date);
    expect(fromCsv.amount).toBe(fromPlaid.amount);
    expect(fromCsv.type).toBe(fromPlaid.type);
    expect(fromCsv.description).toBe(fromPlaid.description);

    // And therefore the dedup fingerprints are identical.
    expect(lineFingerprint(fromCsv.date, fromCsv.amount, fromCsv.type, fromCsv.description)).toBe(
      fingerprintOf(fromPlaid),
    );
  });

  it("a credit reaches the same canonical record from both channels", () => {
    const plaid: PlaidTransaction = {
      transaction_id: "py",
      account_id: "ax",
      amount: -1500.0, // Plaid negative = money in
      iso_currency_code: "AUD",
      date: "2026-04-02",
      name: "CLIENT INVOICE",
      merchant_name: null,
      pending: false,
      personal_finance_category: null,
    };
    const fromPlaid = normalizePlaidTransaction(plaid);
    const { rows } = applyMapping(
      "date,desc,amount\n02/04/2026,CLIENT INVOICE,1500.00",
      SIGNED_MAPPING,
    );
    const fromCsv = rows[0]!;

    expect(fromCsv.type).toBe("credit");
    expect(fromPlaid.type).toBe("credit");
    expect(fromCsv.amount).toBe(fromPlaid.amount); // 150000 cents
    expect(lineFingerprint(fromCsv.date, fromCsv.amount, fromCsv.type, fromCsv.description)).toBe(
      fingerprintOf(fromPlaid),
    );
  });
});
