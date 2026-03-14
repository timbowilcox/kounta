import { getSessionClient } from "@/lib/kounta";
import type { PaginatedResult, TransactionWithLines } from "@kounta/sdk";
import { TransactionsView } from "./transactions-view";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  let txResult: PaginatedResult<TransactionWithLines> = { data: [], nextCursor: null };
  const accountMap: Record<string, { code: string; name: string }> = {};
  let closedThrough: string | null = null;

  try {
    const { client, ledgerId } = await getSessionClient();
    const [txRes, accountsRes] = await Promise.allSettled([
      client.transactions.list(ledgerId, { limit: 50 }),
      client.accounts.list(ledgerId),
    ]);

    if (txRes.status === "fulfilled") txResult = txRes.value;
    if (accountsRes.status === "fulfilled") {
      for (const a of accountsRes.value) {
        accountMap[a.id] = { code: a.code, name: a.name };
      }
    }

    // Fetch closed-through date for period lock indicators
    try {
      const ledger = await client.ledgers.get(ledgerId);
      closedThrough = (ledger as any).closedThrough ?? null;
    } catch {}
  } catch {
    // Session or API error — render empty state
  }

  return <TransactionsView initialData={txResult} accountMap={accountMap} closedThrough={closedThrough} />;
}
