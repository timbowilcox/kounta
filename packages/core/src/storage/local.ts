// ---------------------------------------------------------------------------
// LocalFileStorage — file-system-based attachment storage for dev/self-hosted.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { AttachmentStorage } from "./types.js";

export class LocalFileStorage implements AttachmentStorage {
  constructor(private readonly basePath: string) {
    mkdirSync(basePath, { recursive: true });
  }

  async upload(key: string, data: Buffer, _mimeType: string): Promise<void> {
    const fullPath = join(this.basePath, key);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, data);
  }

  async download(key: string): Promise<{ data: Buffer; mimeType: string }> {
    const fullPath = join(this.basePath, key);
    if (!existsSync(fullPath)) {
      throw new Error(`Attachment not found: ${key}`);
    }
    const data = readFileSync(fullPath);
    // Infer MIME type from extension
    const mimeType = inferMimeType(key);
    return { data: Buffer.from(data), mimeType };
  }

  async delete(key: string): Promise<void> {
    const fullPath = join(this.basePath, key);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  }

  getUrl(_key: string): string | null {
    // Local storage doesn't have public URLs — files are served through the API
    return null;
  }
}

const inferMimeType = (key: string): string => {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "heic": return "image/heic";
    default: return "application/octet-stream";
  }
};
