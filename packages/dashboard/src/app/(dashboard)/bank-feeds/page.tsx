import { redirect } from "next/navigation";

export default function BankFeedsPage() {
  redirect("/settings?tab=bank-feeds");
}
