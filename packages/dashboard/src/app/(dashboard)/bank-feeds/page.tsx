import { getSessionClient } from "@/lib/kounta";
import { BankFeedsView } from "./bank-feeds-view";
import { CsvImport } from "./csv-import";
import { ReviewQueue } from "./review-queue";
import { fetchBankTransactions, fetchAccounts, fetchReviewItems } from "@/lib/actions";
import type { BankTransactionSummary } from "@/lib/actions";
import type { ReviewItem } from "@kounta/sdk";

export const dynamic = "force-dynamic";

export default async function BankFeedsPage() {
  let connections: unknown[] = [];
  let error: string | null = null;
  let bankTxns: BankTransactionSummary[] = [];
  let accounts: { id: string; name: string; code: string }[] = [];

  try {
    const { client, ledgerId } = await getSessionClient();
    connections = await client.bankFeeds.listConnections(ledgerId);

    // Fetch bank transactions (business-only by default)
    bankTxns = await fetchBankTransactions("business", 50);
  } catch (e: unknown) {
    // Bank feeds may not be configured or user may be on free plan
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("403") || msg.includes("Builder plan")) {
      error = "upgrade";
    } else if (msg.includes("503") || msg.includes("not configured")) {
      error = "not-configured";
    } else {
      // Swallow other errors — show empty state
      error = null;
    }
  }

  // Ledger accounts power the manual CSV import target dropdown. This is not
  // plan-gated, so fetch it independently of the bank-feed connection state.
  try {
    accounts = (await fetchAccounts()).map((a) => ({ id: a.id, name: a.name, code: a.code }));
  } catch {
    accounts = [];
  }

  let reviewItems: ReviewItem[] = [];
  try {
    reviewItems = await fetchReviewItems("open");
  } catch {
    reviewItems = [];
  }

  return (
    <div>
      <BankFeedsView connections={connections} error={error} initialBankTxns={bankTxns} />
      <ReviewQueue initialItems={reviewItems} />
      {accounts.length > 0 && <CsvImport accounts={accounts} />}
    </div>
  );
}
