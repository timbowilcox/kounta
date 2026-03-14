// Script to update the createLedger method in engine/index.ts to auto-create users
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "packages", "core", "src", "engine", "index.ts");
let content = fs.readFileSync(filePath, "utf-8");

const oldBlock = `  async createLedger(params: CreateLedgerParams): Promise<Result<Ledger>> {
    const parsed = createLedgerSchema.safeParse(params);
    if (!parsed.success) {
      return err(createError(ErrorCode.VALIDATION_ERROR, parsed.error.message));
    }

    const id = generateId();
    const now = nowUtc();
    const currency = params.currency ?? "USD";
    const fiscalYearStart = params.fiscalYearStart ?? 1;
    const accountingBasis = params.accountingBasis ?? "accrual";
    const businessContext = params.businessContext ? JSON.stringify(params.businessContext) : null;

    await this.db.run(
      \`INSERT INTO ledgers (id, name, currency, fiscal_year_start, accounting_basis, status, owner_id, business_context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)\`,
      [id, params.name, currency, fiscalYearStart, accountingBasis, params.ownerId, businessContext, now, now]
    );`;

const newBlock = `  async createLedger(params: CreateLedgerParams): Promise<Result<Ledger>> {
    const parsed = createLedgerSchema.safeParse(params);
    if (!parsed.success) {
      return err(createError(ErrorCode.VALIDATION_ERROR, parsed.error.message));
    }

    const id = generateId();
    const now = nowUtc();
    const currency = params.currency ?? "USD";
    const fiscalYearStart = params.fiscalYearStart ?? 1;
    const accountingBasis = params.accountingBasis ?? "accrual";
    const businessContext = params.businessContext ? JSON.stringify(params.businessContext) : null;

    // Ensure the owner user exists (auto-create for admin/system callers)
    const existingUser = await this.db.get("SELECT id FROM users WHERE id = ?", [params.ownerId]);
    if (!existingUser) {
      await this.db.run(
        "INSERT INTO users (id, email, name, auth_provider, auth_provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [params.ownerId, \`user-\${params.ownerId.substring(0, 8)}@kounta.internal\`, "Auto-created User", "system", params.ownerId, now, now]
      );
    }

    await this.db.run(
      \`INSERT INTO ledgers (id, name, currency, fiscal_year_start, accounting_basis, status, owner_id, business_context, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)\`,
      [id, params.name, currency, fiscalYearStart, accountingBasis, params.ownerId, businessContext, now, now]
    );`;

if (!content.includes(oldBlock)) {
  // Try with different line endings
  const oldBlockCRLF = oldBlock.replace(/\n/g, "\r\n");
  if (content.includes(oldBlockCRLF)) {
    content = content.replace(oldBlockCRLF, newBlock.replace(/\n/g, "\r\n"));
  } else {
    console.error("Could not find the createLedger block to replace");
    process.exit(1);
  }
} else {
  content = content.replace(oldBlock, newBlock);
}

try { fs.unlinkSync(filePath); } catch {}
fs.writeFileSync(filePath, content);
console.log("✓ Updated createLedger in", filePath);
