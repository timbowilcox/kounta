import { getSessionClient } from "@/lib/ledge";
import { TransactionsView } from "./transactions-view";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const { client, ledgerId } = await getSessionClient();

  const [txResult, accounts] = await Promise.all([
    client.transactions.list(ledgerId, { limit: 50 }),
    client.accounts.list(ledgerId),
  ]);

  // Build accountId -> { code, name } lookup for line item display
  const accountMap: Record<string, { code: string; name: string }> = {};
  for (const a of accounts) {
    accountMap[a.id] = { code: a.code, name: a.name };
  }

  return <TransactionsView initialData={txResult} accountMap={accountMap} />;
}
