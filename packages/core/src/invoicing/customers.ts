// ---------------------------------------------------------------------------
// Customer CRUD — lightweight contact records for repeated invoicing
// ---------------------------------------------------------------------------

import type { Database } from "../db/database.js";
import { generateId, nowUtc } from "../engine/id.js";
import type { Result } from "../types/index.js";
import { ErrorCode, createError, ok, err } from "../errors/index.js";
import type { PaymentTermsCode } from "./payment-terms.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Customer {
  readonly id: string;
  readonly ledgerId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  readonly paymentTerms: string;
  readonly notes: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerRow {
  id: string;
  ledger_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  tax_id: string | null;
  payment_terms: string;
  notes: string | null;
  is_active: number | boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateCustomerInput {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly address?: string;
  readonly taxId?: string;
  readonly paymentTerms?: PaymentTermsCode;
  readonly notes?: string;
}

export interface UpdateCustomerInput {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly address?: string | null;
  readonly taxId?: string | null;
  readonly paymentTerms?: PaymentTermsCode;
  readonly notes?: string | null;
  readonly isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

const toBool = (v: number | boolean | null | undefined): boolean =>
  v === true || v === 1;

export const mapCustomer = (row: CustomerRow): Customer => ({
  id: row.id,
  ledgerId: row.ledger_id,
  name: row.name,
  email: row.email,
  phone: row.phone,
  address: row.address,
  taxId: row.tax_id,
  paymentTerms: row.payment_terms ?? "net_30",
  notes: row.notes,
  isActive: toBool(row.is_active),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ---------------------------------------------------------------------------
// Create customer
// ---------------------------------------------------------------------------

export const createCustomer = async (
  db: Database,
  ledgerId: string,
  input: CreateCustomerInput,
): Promise<Result<Customer>> => {
  if (!input.name || input.name.trim().length === 0) {
    return err(createError(ErrorCode.VALIDATION_ERROR, "Customer name is required", [
      { field: "name", expected: "non-empty string", actual: "empty" },
    ]));
  }

  const id = generateId();
  const now = nowUtc();

  await db.run(
    `INSERT INTO customers (
      id, ledger_id, name, email, phone, address,
      tax_id, payment_terms, notes, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, ledgerId, input.name.trim(),
      input.email ?? null, input.phone ?? null, input.address ?? null,
      input.taxId ?? null, input.paymentTerms ?? "net_30",
      input.notes ?? null, 1, now, now,
    ],
  );

  const row = await db.get<CustomerRow>("SELECT * FROM customers WHERE id = ?", [id]);
  return ok(mapCustomer(row!));
};

// ---------------------------------------------------------------------------
// Update customer
// ---------------------------------------------------------------------------

export const updateCustomer = async (
  db: Database,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<Result<Customer>> => {
  const existing = await db.get<CustomerRow>("SELECT * FROM customers WHERE id = ?", [customerId]);
  if (!existing) {
    return err(createError(ErrorCode.CUSTOMER_NOT_FOUND, `Customer not found: ${customerId}`));
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name.trim()); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.address !== undefined) { sets.push("address = ?"); params.push(input.address); }
  if (input.taxId !== undefined) { sets.push("tax_id = ?"); params.push(input.taxId); }
  if (input.paymentTerms !== undefined) { sets.push("payment_terms = ?"); params.push(input.paymentTerms); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
  if (input.isActive !== undefined) { sets.push("is_active = ?"); params.push(input.isActive ? 1 : 0); }

  if (sets.length === 0) {
    return ok(mapCustomer(existing));
  }

  sets.push("updated_at = ?");
  params.push(nowUtc());
  params.push(customerId);

  await db.run(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`, params);

  const row = await db.get<CustomerRow>("SELECT * FROM customers WHERE id = ?", [customerId]);
  return ok(mapCustomer(row!));
};

// ---------------------------------------------------------------------------
// Get customer
// ---------------------------------------------------------------------------

export const getCustomer = async (
  db: Database,
  customerId: string,
): Promise<Result<Customer>> => {
  const row = await db.get<CustomerRow>("SELECT * FROM customers WHERE id = ?", [customerId]);
  if (!row) {
    return err(createError(ErrorCode.CUSTOMER_NOT_FOUND, `Customer not found: ${customerId}`));
  }
  return ok(mapCustomer(row));
};

// ---------------------------------------------------------------------------
// List customers
// ---------------------------------------------------------------------------

export const listCustomers = async (
  db: Database,
  ledgerId: string,
  filters?: {
    search?: string;
    isActive?: boolean;
    cursor?: string;
    limit?: number;
  },
): Promise<{ data: Customer[]; cursor: string | null }> => {
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

  const rows = await db.all<CustomerRow>(
    `SELECT * FROM customers
     WHERE ${conditions.join(" AND ")}
     ORDER BY name ASC, id
     LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: data.map(mapCustomer),
    cursor: hasMore && data.length > 0 ? data[data.length - 1]!.id : null,
  };
};

// ---------------------------------------------------------------------------
// Delete customer (soft delete)
// ---------------------------------------------------------------------------

export const deleteCustomer = async (
  db: Database,
  customerId: string,
): Promise<Result<Customer>> => {
  const existing = await db.get<CustomerRow>("SELECT * FROM customers WHERE id = ?", [customerId]);
  if (!existing) {
    return err(createError(ErrorCode.CUSTOMER_NOT_FOUND, `Customer not found: ${customerId}`));
  }

  // Check if customer has non-draft invoices
  const invoiceCount = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM invoices WHERE customer_id = ? AND status != 'draft'",
    [customerId],
  );

  if (invoiceCount && invoiceCount.cnt > 0) {
    // Soft delete — mark as inactive
    await db.run(
      "UPDATE customers SET is_active = ?, updated_at = ? WHERE id = ?",
      [0, nowUtc(), customerId],
    );
  } else {
    // No non-draft invoices — can hard delete
    // First unlink any draft invoices
    await db.run(
      "UPDATE invoices SET customer_id = NULL WHERE customer_id = ? AND status = 'draft'",
      [customerId],
    );
    await db.run("DELETE FROM customers WHERE id = ?", [customerId]);
  }

  const row = await db.get<CustomerRow>("SELECT * FROM customers WHERE id = ?", [customerId]);
  if (row) return ok(mapCustomer(row));

  // Hard deleted — return the last known state
  return ok(mapCustomer({ ...existing, is_active: 0 }));
};

// ---------------------------------------------------------------------------
// Get customer invoices
// ---------------------------------------------------------------------------

export const getCustomerInvoiceIds = async (
  db: Database,
  customerId: string,
): Promise<string[]> => {
  const rows = await db.all<{ id: string }>(
    "SELECT id FROM invoices WHERE customer_id = ? ORDER BY created_at DESC",
    [customerId],
  );
  return rows.map((r) => r.id);
};
