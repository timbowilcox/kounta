import { Kounta } from "@kounta/sdk";

const apiKey = process.env.KOUNTA_API_KEY ?? "";
const adminSecret = process.env.KOUNTA_ADMIN_SECRET ?? "";
const baseUrl = process.env.KOUNTA_BASE_URL ?? "http://localhost:3001";

export const kounta = new Kounta({
  apiKey,
  adminSecret,
  baseUrl,
});

export const LEDGER_ID = process.env.KOUNTA_LEDGER_ID ?? "";
