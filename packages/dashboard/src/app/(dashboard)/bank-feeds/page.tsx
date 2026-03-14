import { getSessionClient } from "@/lib/kounta";
import { BankFeedsView } from "./bank-feeds-view";
import { fetchBankTransactions } from "@/lib/actions";
import type { BankTransactionSummary } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function BankFeedsPage() {
  let connections: unknown[] = [];
  let error: string | null = null;
  let bankTxns: BankTransactionSummary[] = [];

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

  return <BankFeedsView connections={connections} error={error} initialBankTxns={bankTxns} />;
}
