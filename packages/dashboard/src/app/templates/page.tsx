import { getKountaClient } from "@/lib/kounta";
import { TemplatesGrid } from "./templates-grid";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const client = getKountaClient();
  const templates = await client.templates.list();

  return <TemplatesGrid templates={templates} />;
}
