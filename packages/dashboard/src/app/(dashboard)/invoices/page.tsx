import {
  fetchInvoices,
  fetchInvoiceSummary,
  fetchARAging,
  fetchAccounts,
  fetchJurisdictionSettings,
  fetchJurisdictions,
  fetchCustomers,
} from "@/lib/actions";
import { InvoicesView } from "./invoices-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [invoices, summary, aging, accounts, jurisdictionSettings, jurisdictions, customers] = await Promise.allSettled([
    fetchInvoices(),
    fetchInvoiceSummary(),
    fetchARAging(),
    fetchAccounts(),
    fetchJurisdictionSettings(),
    fetchJurisdictions(),
    fetchCustomers(),
  ]);

  // Resolve tax config from jurisdiction
  const jCode = jurisdictionSettings.status === "fulfilled" ? jurisdictionSettings.value.jurisdiction : "AU";
  const jList = jurisdictions.status === "fulfilled" ? jurisdictions.value : [];
  const jMatch = jList.find((j) => j.code === jCode);
  const taxLabel = jMatch?.vatName ?? "Tax";
  const taxRate = jMatch?.vatRate != null ? jMatch.vatRate / 100 : 0;

  return (
    <InvoicesView
      initialInvoices={invoices.status === "fulfilled" ? invoices.value : []}
      initialSummary={
        summary.status === "fulfilled"
          ? summary.value
          : {
              totalOutstanding: 0,
              totalOverdue: 0,
              totalDraft: 0,
              totalPaidThisMonth: 0,
              invoiceCount: 0,
              overdueCount: 0,
              averageDaysToPayment: null,
              currency: "USD",
            }
      }
      initialAging={aging.status === "fulfilled" ? aging.value : []}
      accounts={accounts.status === "fulfilled" ? accounts.value : []}
      customers={customers.status === "fulfilled" ? customers.value : []}
      taxLabel={taxLabel}
      taxRate={taxRate}
    />
  );
}
