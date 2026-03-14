import { getSessionClient } from "@/lib/kounta";
import { NotificationsView } from "./notifications-view";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  let notifications: readonly unknown[] = [];
  let error: string | null = null;

  try {
    const { client, ledgerId } = await getSessionClient();
    const result = await client.notifications.list(ledgerId, { limit: 50 });
    notifications = result.data;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("403") || msg.includes("Builder plan")) {
      error = "upgrade";
    } else {
      error = null;
    }
  }

  return <NotificationsView notifications={notifications} error={error} />;
}
