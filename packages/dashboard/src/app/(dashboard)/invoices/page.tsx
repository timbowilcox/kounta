import {
  fetchInvoices,
  fetchInvoiceSummary,
  fetchARAging,
  fetchAccounts,
} from "@/lib/actions";
import { InvoicesView } from "./invoices-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [invoices, summary, aging, accounts] = await Promise.allSettled([
    fetchInvoices(),
    fetchInvoiceSummary(),
    fetchARAging(),
    fetchAccounts(),
  ]);

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
    />
  );
}
