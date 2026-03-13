import { getSessionClient } from "@/lib/ledge";
import { AssistantView } from "./assistant-view";
import type { Conversation } from "@ledge/sdk";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  let conversations: Conversation[] = [];

  try {
    const { client, ledgerId } = await getSessionClient();
    const result = await client.conversations.list(ledgerId, { limit: 50 });
    conversations = [...result.data];
  } catch {
    // If conversations endpoint fails (e.g. table doesn't exist yet),
    // gracefully fall back to empty list
  }

  return <AssistantView initialConversations={conversations} />;
}
