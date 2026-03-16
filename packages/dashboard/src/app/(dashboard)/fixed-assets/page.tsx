import {
  fetchFixedAssets,
  fetchAssetSummary,
  fetchAccounts,
} from "@/lib/actions";
import { FixedAssetsView } from "./fixed-assets-view";

export const dynamic = "force-dynamic";

export default async function FixedAssetsPage() {
  const [assets, summary, accounts] = await Promise.allSettled([
    fetchFixedAssets(),
    fetchAssetSummary(),
    fetchAccounts(),
  ]);

  return (
    <FixedAssetsView
      initialAssets={assets.status === "fulfilled" ? assets.value : []}
      initialSummary={
        summary.status === "fulfilled"
          ? summary.value
          : {
              totalAssets: 0,
              totalCost: 0,
              totalNbv: 0,
              totalAccumulated: 0,
              pendingEntries: 0,
              pendingAmount: 0,
              nextDepreciationDate: null,
              currentFinancialYear: "",
              depreciationThisFy: 0,
              depreciationLastFy: 0,
              assetsByStatus: { active: 0, disposed: 0, fullyDepreciated: 0 },
            }
      }
      accounts={accounts.status === "fulfilled" ? accounts.value : []}
    />
  );
}
