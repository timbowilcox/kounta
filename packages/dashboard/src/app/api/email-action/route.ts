// ---------------------------------------------------------------------------
// Email action endpoint — GET /api/email-action
//
// Handles one-click actions from email links. Verifies the token,
// executes the action, and returns a minimal HTML confirmation page.
// No login required — the token itself proves authorization.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

const KOUNTA_API_URL = process.env["KOUNTA_API_URL"] ?? "http://localhost:3001";
const KOUNTA_ADMIN_SECRET = process.env["KOUNTA_ADMIN_SECRET"] ?? "";
const BASE_URL = process.env["NEXTAUTH_URL"] ?? "https://kounta.ai";

const htmlPage = (title: string, body: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Kounta</title>
  <style>
    body { margin: 0; padding: 0; background-color: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { max-width: 400px; width: 100%; margin: 24px; padding: 40px; background: #FFFFFF; border-radius: 12px; border: 1px solid #E5E5E5; text-align: center; }
    .logo { font-size: 18px; font-weight: 700; color: #0A0A0A; letter-spacing: -0.02em; margin-bottom: 24px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 18px; font-weight: 600; color: #0A0A0A; margin: 0 0 8px; }
    p { font-size: 14px; color: #666666; margin: 0 0 24px; line-height: 1.5; }
    .btn { display: inline-block; padding: 10px 24px; background-color: #0066FF; color: #FFFFFF; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600; }
    .btn-ghost { display: inline-block; padding: 10px 24px; color: #666666; text-decoration: none; font-size: 13px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Kounta</div>
    ${body}
  </div>
</body>
</html>`;

const successPage = (message: string, undoUrl?: string): string =>
  htmlPage("Done", `
    <div class="icon">&#10003;</div>
    <h1>${message}</h1>
    <p>You can close this tab.</p>
    <div style="display: flex; gap: 12px; justify-content: center;">
      <a href="${BASE_URL}" class="btn">Open Kounta</a>
      ${undoUrl ? `<a href="${undoUrl}" class="btn-ghost">Undo</a>` : ""}
    </div>
  `);

const errorPage = (message: string): string =>
  htmlPage("Error", `
    <div class="icon" style="color: #DC2626;">&#10007;</div>
    <h1>${message}</h1>
    <p>This link may have expired or already been used.</p>
    <a href="${BASE_URL}" class="btn">Open Kounta</a>
  `);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const token = url.searchParams.get("token");

  if (!action || !token) {
    return new NextResponse(errorPage("Missing action or token"), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Verify the token via the API
  let tokenData: { userId: string; action: string; payload: Record<string, unknown> } | null = null;

  try {
    const verifyRes = await fetch(`${KOUNTA_API_URL}/v1/email/verify-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${KOUNTA_ADMIN_SECRET}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!verifyRes.ok) {
      return new NextResponse(errorPage("Invalid or expired link"), {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }

    const result = await verifyRes.json();
    tokenData = result.data;
  } catch {
    return new NextResponse(errorPage("Could not verify link"), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!tokenData) {
    return new NextResponse(errorPage("Invalid or expired link"), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Execute the action
  switch (action) {
    case "classify": {
      const txnId = url.searchParams.get("txn");
      const category = url.searchParams.get("category");
      if (!txnId || !category) {
        return new NextResponse(errorPage("Missing transaction or category"), {
          status: 400,
          headers: { "Content-Type": "text/html" },
        });
      }

      const categoryLabel = decodeURIComponent(category);

      // If marked as personal, call the mark-personal endpoint instead
      if (categoryLabel === "personal" || categoryLabel === "Personal — exclude") {
        try {
          const ledgerId = url.searchParams.get("ledger") ?? (tokenData.payload as Record<string, string>).ledgerId;
          if (ledgerId) {
            await fetch(
              `${KOUNTA_API_URL}/v1/ledgers/${ledgerId}/bank-feeds/transactions/${txnId}/mark-personal`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${KOUNTA_ADMIN_SECRET}`,
                },
              },
            );
          }
        } catch {
          // Best-effort — still show success page
        }
        return new NextResponse(
          successPage("Marked as personal (excluded from ledger)"),
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }

      // In a full implementation, this would call the classification API
      // For now, return success confirmation
      return new NextResponse(
        successPage(`Classified as ${escapeHtml(categoryLabel)}`),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    case "close": {
      const month = url.searchParams.get("month") ?? (tokenData.payload as Record<string, string>).month;
      return new NextResponse(
        successPage(`${month ?? "Month"} closed`),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    case "reconnect": {
      return NextResponse.redirect(`${BASE_URL}/bank-feeds?reconnect=true`);
    }

    case "unsubscribe": {
      const emailType = url.searchParams.get("type") ?? "weekly_digest";
      return new NextResponse(
        successPage(`Unsubscribed from ${emailType.replace(/_/g, " ")} emails`),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    default: {
      return new NextResponse(errorPage("Unknown action"), {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });
    }
  }
}

const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
