// ---------------------------------------------------------------------------
// Hono context types for the Ledge API.
// ---------------------------------------------------------------------------

import type { LedgerEngine, AttachmentStorage } from "@ledge/core";

export type Env = {
  Variables: {
    engine: LedgerEngine;
    /** Set by API key auth middleware */
    apiKeyInfo?: {
      id: string;
      userId: string;
      ledgerId: string;
    };
    /** Unique request ID for tracing */
    requestId: string;
    /** Attachment file storage (optional — set if LEDGE_ATTACHMENTS_DIR is configured) */
    storage?: AttachmentStorage;
  };
};
