import { Kounta } from "@kounta/sdk";

export const kounta = new Kounta({
  baseUrl: process.env.KOUNTA_BASE_URL ?? "http://localhost:3100",
  apiKey: process.env.KOUNTA_API_KEY ?? "",
});

export const ledgerId = process.env.KOUNTA_LEDGER_ID ?? "";
