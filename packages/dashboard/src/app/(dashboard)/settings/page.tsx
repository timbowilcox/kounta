import { getSessionClient } from "@/lib/kounta";
import { fetchBillingStatus, fetchApiKeys, fetchClosedPeriods } from "@/lib/actions";
import type { ClosedPeriodSummary } from "@/lib/actions";
import { SettingsView } from "./settings-view";
import type { ApiKeySafe, AccountWithBalance } from "@kounta/sdk";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { client, ledgerId } = await getSessionClient();

  const [ledger, billing, apiKeys, currenciesRaw, exchangeRatesRaw, accounts] = await Promise.all([
    client.ledgers.get(ledgerId),
    fetchBillingStatus(),
    fetchApiKeys(),
    client.currencies.list(ledgerId).catch(() => []),
    client.currencies.listRates(ledgerId).catch(() => ({ data: [], nextCursor: null })),
    client.accounts.list(ledgerId).catch(() => [] as AccountWithBalance[]),
  ]);

  // currencies.list() returns CurrencySetting[] via request() unwrap;
  // listRates() returns PaginatedResult<ExchangeRate> { data, nextCursor }.
  // Defensive: handle unexpected shapes from either endpoint.
  const currencies = Array.isArray(currenciesRaw) ? currenciesRaw : (currenciesRaw as any)?.data ?? [];
  const exchangeRates = Array.isArray(exchangeRatesRaw) ? exchangeRatesRaw : (exchangeRatesRaw as any)?.data ?? [];

  let fiscalYearStart = 1;
  let closedThrough: string | null = null;
  let closedPeriods: ClosedPeriodSummary[] = [];
  try {
    fiscalYearStart = (ledger as any).fiscalYearStart ?? 1;
    closedThrough = (ledger as any).closedThrough ?? null;
  } catch {}
  try {
    closedPeriods = await fetchClosedPeriods();
  } catch {}

  return (
    <SettingsView
      ledger={ledger}
      billing={billing}
      initialKeys={[...apiKeys] as ApiKeySafe[]}
      currencies={currencies as any[]}
      exchangeRates={exchangeRates as any[]}
      fiscalYearStart={fiscalYearStart}
      closedThrough={closedThrough}
      closedPeriods={closedPeriods}
      accounts={accounts as AccountWithBalance[]}
    />
  );
}
