import { getSessionClient } from "@/lib/kounta";
import { fetchBillingStatus, fetchApiKeys, fetchClosedPeriods, fetchJurisdictions, fetchJurisdictionSettings } from "@/lib/actions";
import type { ClosedPeriodSummary, JurisdictionOption, JurisdictionSettings } from "@/lib/actions";
import { SettingsView } from "./settings-view";
import type { ApiKeySafe, AccountWithBalance } from "@kounta/sdk";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let client: Awaited<ReturnType<typeof getSessionClient>>["client"];
  let ledgerId: string;

  try {
    const sc = await getSessionClient();
    client = sc.client;
    ledgerId = sc.ledgerId;
  } catch {
    // Session missing apiKey/ledgerId — force re-auth
    redirect("/signin?callbackUrl=/settings");
  }

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
  let jurisdictions: JurisdictionOption[] = [];
  let jurisdictionSettings: JurisdictionSettings = { jurisdiction: "AU", taxId: null, taxBasis: "accrual" };
  try {
    fiscalYearStart = (ledger as any).fiscalYearStart ?? 1;
    closedThrough = (ledger as any).closedThrough ?? null;
  } catch {}
  try {
    closedPeriods = await fetchClosedPeriods();
  } catch {}
  try {
    [jurisdictions, jurisdictionSettings] = await Promise.all([
      fetchJurisdictions(),
      fetchJurisdictionSettings(),
    ]);
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
      jurisdictions={jurisdictions}
      jurisdictionSettings={jurisdictionSettings}
    />
  );
}
