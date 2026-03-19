// ---------------------------------------------------------------------------
// Vendor CRUD — lightweight contact records for repeated bill entry
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import { generateId, nowUtc } from "../engine/id.js";
import type { Result } from "../types/index.js";
import { ErrorCode, createError, ok, err } from "../errors/index.js";
import type { PaymentTermsCode } from "../invoicing/payment-terms.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Vendor {
  readonly id: string;
  readonly ledgerId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  readonly paymentTerms: string;
  readonly defaultExpenseAccountId: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VendorRow {
  id: string;
  ledger_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  payment_terms: string;
  default_expense_account_id: string | null;
  notes: string | null;
  is_active: number | boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateVendorInput {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address?: string;
  readonly taxId?: string;
  readonly paymentTerms?: PaymentTermsCode;
  readonly defaultExpenseAccountId?: string;
  readonly notes?: string;
}

export interface UpdateVendorInput {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly address?: string | null;
  readonly taxId?: string | null;
  readonly paymentTerms?: PaymentTermsCode;
  readonly defaultExpenseAccountId?: string | null;
  readonly notes?: string | null;
  readonly isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

const toBool = (v: number | boolean | null | undefined): boolean =>
  v === true || v === 1;

export const mapVendor = (row: VendorRow): Vendor => ({
  id: row.id,
  ledgerId: row.ledger_id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  address: row.address,
  taxId: row.tax_id,
  paymentTerms: row.payment_terms ?? "net_30",
  defaultExpenseAccountId: row.default_expense_account_id,
  notes: row.notes,
  isActive: toBool(row.is_active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ---------------------------------------------------------------------------
// Create vendor
// ---------------------------------------------------------------------------

export const createVendor = async (
  db: Database,
  ledgerId: string,
  input: CreateVendorInput,
): Promise<Result<Vendor>> => {
  if (!input.name || input.name.trim().length === 0) {
    return err(createError(ErrorCode.VALIDATION_ERROR, "Vendor name is required", [
      { field: "name", expected: "non-empty string", actual: "empty" },
    ]));
  }

  const id = generateId();
  const now = nowUtc();

  await db.run(
    `INSERT INTO vendors (
      id, ledger_id, name, email, phone, address,
      tax_id, payment_terms, default_expense_account_id,
      notes, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, ledgerId, input.name.trim(),
      input.email ?? null, input.phone ?? null, input.address ?? null,
      input.taxId ?? null, input.paymentTerms ?? "net_30",
      input.defaultExpenseAccountId ?? null,
      input.notes ?? null, 1, now, now,
    ],
  );

  const row = await db.get<VendorRow>("SELECT * FROM vendors WHERE id = ?", [id]);
  return ok(mapVendor(row!));
};

// ---------------------------------------------------------------------------
// Update vendor
// ---------------------------------------------------------------------------

export const updateVendor = async (
  db: Database,
  vendorId: string,
  input: UpdateVendorInput,
): Promise<Result<Vendor>> => {
  const existing = await db.get<VendorRow>("SELECT * FROM vendors WHERE id = ?", [vendorId]);
  if (!existing) {
    return err(createError(ErrorCode.VENDOR_NOT_FOUND, `Vendor not found: ${vendorId}`));
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name.trim()); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.address !== undefined) { sets.push("address = ?"); params.push(input.address); }
  if (input.taxId !== undefined) { sets.push("tax_id = ?"); params.push(input.taxId); }
  if (input.paymentTerms !== undefined) { sets.push("payment_terms = ?"); params.push(input.paymentTerms); }
  if (input.defaultExpenseAccountId !== undefined) { sets.push("default_expense_account_id = ?"); params.push(input.defaultExpenseAccountId); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
  if (input.isActive !== undefined) { sets.push("is_active = ?"); params.push(input.isActive ? 1 : 0); }

  if (sets.length === 0) {
    return ok(mapVendor(existing));
  }

  sets.push("updated_at = ?");
  params.push(nowUtc());
  params.push(vendorId);

  await db.run(`UPDATE vendors SET ${sets.join(", ")} WHERE id = ?`, params);

  const row = await db.get<VendorRow>("SELECT * FROM vendors WHERE id = ?", [vendorId]);
  return ok(mapVendor(row!));
};

// ---------------------------------------------------------------------------
// Get vendor
// ---------------------------------------------------------------------------

export const getVendor = async (
  db: Database,
  vendorId: string,
): Promise<Result<Vendor>> => {
  const row = await db.get<VendorRow>("SELECT * FROM vendors WHERE id = ?", [vendorId]);
  if (!row) {
    return err(createError(ErrorCode.VENDOR_NOT_FOUND, `Vendor not found: ${vendorId}`));
  }
  return ok(mapVendor(row));
};

// ---------------------------------------------------------------------------
// List vendors
// ---------------------------------------------------------------------------

export const listVendors = async (
  db: Database,
  ledgerId: string,
  filters?: {
    search?: string;
    isActive?: boolean;
    cursor?: string;
    limit?: number;
  },
): Promise<{ data: Vendor[]; cursor: string | null }> => {
  const limit = Math.min(filters?.limit ?? 50, 200);
  const conditions: string[] = ["ledger_id = ?"];
  const params: unknown[] = [ledgerId];

  if (filters?.search) {
    conditions.push("(name LIKE ? OR email LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters?.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(filters.isActive ? 1 : 0);
  }
  if (filters?.cursor) {
    conditions.push("id > ?");
    params.push(filters.cursor);
  }

  params.push(limit + 1);

  const rows = await db.all<VendorRow>(
    `SELECT * FROM vendors
     WHERE ${conditions.join(" AND ")}
     ORDER BY name ASC, id
     LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: data.map(mapVendor),
    cursor: hasMore && data.length > 0 ? data[data.length - 1]!.id : null,
  };
};

// ---------------------------------------------------------------------------
// Delete vendor (soft delete)
// ---------------------------------------------------------------------------

export const deleteVendor = async (
  db: Database,
  vendorId: string,
): Promise<Result<Vendor>> => {
  const existing = await db.get<VendorRow>("SELECT * FROM vendors WHERE id = ?", [vendorId]);
  if (!existing) {
    return err(createError(ErrorCode.VENDOR_NOT_FOUND, `Vendor not found: ${vendorId}`));
  }

  // Check if vendor has non-draft bills
  const billCount = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM bills WHERE vendor_id = ? AND status != 'draft'",
    [vendorId],
  );

  if (billCount && billCount.cnt > 0) {
    // Soft delete — mark as inactive
    await db.run(
      "UPDATE vendors SET is_active = ?, updated_at = ? WHERE id = ?",
      [0, nowUtc(), vendorId],
    );
  } else {
    // No non-draft bills — can hard delete
    // First unlink any draft bills
    await db.run(
      "UPDATE bills SET vendor_id = NULL WHERE vendor_id = ? AND status = 'draft'",
      [vendorId],
    );
    await db.run("DELETE FROM vendors WHERE id = ?", [vendorId]);
  }

  const row = await db.get<VendorRow>("SELECT * FROM vendors WHERE id = ?", [vendorId]);
  if (row) return ok(mapVendor(row));

  // Hard deleted — return the last known state
  return ok(mapVendor({ ...existing, is_active: 0 }));
};

// ---------------------------------------------------------------------------
// Get vendor bills
// ---------------------------------------------------------------------------

export const getVendorBillIds = async (
  db: Database,
  vendorId: string,
): Promise<string[]> => {
  const rows = await db.all<{ id: string }>(
    "SELECT id FROM bills WHERE vendor_id = ? ORDER BY created_at DESC",
    [vendorId],
  );
  return rows.map((r) => r.id);
};
