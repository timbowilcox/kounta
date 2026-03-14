// ---------------------------------------------------------------------------
// Server-side provision helper — calls the Kounta API provision endpoint
// to find-or-create a user, ledger, and API key in a single round-trip.
// ---------------------------------------------------------------------------

interface ProvisionInput {
  email: string;
  name: string;
  authProvider: string;
  authProviderId: string;
}

interface ProvisionResult {
  userId: string;
  ledgerId: string;
  apiKey: string;
  needsTemplate: boolean;
  needsOnboarding: boolean;
  isNew: boolean;
}

export async function provisionUser(input: ProvisionInput): Promise<ProvisionResult> {
  const apiUrl = process.env.KOUNTA_API_URL;
  const adminSecret = process.env.KOUNTA_ADMIN_SECRET;

  if (!apiUrl || !adminSecret) {
    throw new Error("Missing KOUNTA_API_URL or KOUNTA_ADMIN_SECRET environment variables");
  }

  const res = await fetch(`${apiUrl}/v1/admin/provision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminSecret}`,
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Provision failed (${res.status}): ${text}`);
  }

  const json = await res.json() as {
    data: {
      user: { id: string };
      ledger: { id: string };
      apiKey: { rawKey: string };
      needsTemplate: boolean;
      needsOnboarding: boolean;
      isNew: boolean;
    };
  };

  return {
    userId: json.data.user.id,
    ledgerId: json.data.ledger.id,
    apiKey: json.data.apiKey.rawKey,
    needsTemplate: json.data.needsTemplate,
    needsOnboarding: json.data.needsOnboarding ?? json.data.needsTemplate,
    isNew: json.data.isNew,
  };
}
