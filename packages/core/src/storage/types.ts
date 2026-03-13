// ---------------------------------------------------------------------------
// AttachmentStorage — pluggable storage interface for transaction attachments.
//
// Implementations: LocalFileStorage (dev/self-hosted), S3/Supabase (future).
// ---------------------------------------------------------------------------

export interface AttachmentStorage {
  /** Upload a file to storage. */
  upload(key: string, data: Buffer, mimeType: string): Promise<void>;
  /** Download a file from storage. Returns data + MIME type. */
  download(key: string): Promise<{ data: Buffer; mimeType: string }>;
  /** Delete a file from storage. */
  delete(key: string): Promise<void>;
  /** Get a public URL for the file, or null if not applicable. */
  getUrl(key: string): string | null;
}
