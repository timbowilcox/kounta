import { getSessionClient } from "@/lib/kounta";
import { CurrenciesView } from "./currencies-view";

export const dynamic = "force-dynamic";

export default async function CurrenciesPage() {
  let currencies: readonly unknown[] = [];
  let exchangeRates: readonly unknown[] = [];
  let error: string | null = null;

  try {
    const { client, ledgerId } = await getSessionClient();
    currencies = await client.currencies.list(ledgerId);
    const ratesResult = await client.currencies.listRates(ledgerId, { limit: 50 });
    exchangeRates = ratesResult.data;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("403") || msg.includes("Builder plan")) {
      error = "upgrade";
    } else {
      error = null;
    }
  }

  return <CurrenciesView currencies={currencies} exchangeRates={exchangeRates} error={error} />;
}
