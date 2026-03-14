// ---------------------------------------------------------------------------
// Stripe webhook handler
//
// Listens for `invoice.payment_succeeded` events and posts a journal entry
// to Kounta: debit Cash (1000), credit Subscription Revenue (4000).
//
// For production use, verify the Stripe signature with STRIPE_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { kounta, LEDGER_ID } from "@/lib/kounta";

interface StripeInvoice {
  id: string;
  amount_paid: number;
  currency: string;
  customer_email: string | null;
  subscription: string | null;
  lines?: {
    data?: Array<{
      description?: string;
      amount?: number;
    }>;
  };
}

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: StripeInvoice;
  };
}

export async function POST(req: NextRequest) {
  if (!LEDGER_ID) {
    return NextResponse.json(
      { error: "KOUNTA_LEDGER_ID not configured" },
      { status: 500 },
    );
  }

  // --- Verify Stripe signature (optional but recommended) ---
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const body = await req.text();

  let event: StripeEvent;

  if (webhookSecret) {
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
    }

    // Dynamic import so Stripe isn't required at build time
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret) as unknown as StripeEvent;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signature verification failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else {
    // No signature verification — development mode
    event = JSON.parse(body) as StripeEvent;
  }

  // --- Only handle invoice.payment_succeeded ---
  if (event.type !== "invoice.payment_succeeded") {
    return NextResponse.json({ received: true, skipped: event.type });
  }

  const invoice = event.data.object;
  const amountCents = invoice.amount_paid; // Stripe already uses cents
  const description = invoice.lines?.data?.[0]?.description ?? "Subscription payment";
  const customerEmail = invoice.customer_email ?? "unknown";

  try {
    const txn = await kounta.transactions.post(LEDGER_ID, {
      date: new Date().toISOString(),
      memo: `${description} — ${customerEmail}`,
      idempotencyKey: `stripe:${invoice.id}`,
      sourceType: "api",
      sourceRef: invoice.id,
      metadata: {
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId: invoice.subscription,
        customerEmail,
      },
      lines: [
        { accountCode: "1000", amount: amountCents, direction: "debit" },
        { accountCode: "4000", amount: amountCents, direction: "credit" },
      ],
    });

    return NextResponse.json({
      received: true,
      transactionId: txn.id,
      amount: amountCents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to post transaction";
    console.error("Kounta transaction failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
