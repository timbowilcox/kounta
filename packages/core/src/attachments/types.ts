// ---------------------------------------------------------------------------
// Attachment types — transaction receipt/document attachments.
// ---------------------------------------------------------------------------

export interface TransactionAttachment {
  readonly id: string;
  readonly transactionId: string;
  readonly ledgerId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly uploadedBy: string;
  readonly createdAt: string;
}

export interface TransactionAttachmentRow {
  id: string;
  transaction_id: string;
  ledger_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
}

export interface CreateAttachmentInput {
  readonly transactionId: string;
  readonly ledgerId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly uploadedBy: string;
}

export const toTransactionAttachment = (row: TransactionAttachmentRow): TransactionAttachment => ({
  id: row.id,
  transactionId: row.transaction_id,
  ledgerId: row.ledger_id,
  filename: row.filename,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  storageKey: row.storage_key,
  uploadedBy: row.uploaded_by,
  createdAt: row.created_at,
});
