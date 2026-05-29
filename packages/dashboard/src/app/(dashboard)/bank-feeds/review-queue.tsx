"use client";

// ---------------------------------------------------------------------------
// Review queue — surfaces ledger-scoped escalations that need a human decision:
//   * possible_duplicate_import — a held CSV candidate (same amount as a feed
//     row within a few days, different description): Import or Dismiss.
//   * removed_reconciled_txn — a reconciled transaction the feed reported as
//     removed: Acknowledge or Dismiss.
// All parsing/decisions happen server-side; this only renders + calls the API.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { ReviewItem } from "@kounta/sdk";
import { resolveReviewItem } from "@/lib/actions";

interface ReviewQueueProps {
  initialItems: ReviewItem[];
}

function amountLabel(payload: Record<string, unknown>): string {
  const row = (payload as { row?: { amount?: number; type?: string; description?: string } }).row;
  const snap = (payload as { snapshot?: { amount?: number; type?: string; description?: string } }).snapshot;
  const src = row ?? snap;
  if (!src || typeof src.amount !== "number") return "";
  const dollars = (src.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${src.type === "debit" ? "−" : "+"}${dollars} · ${src.description ?? ""}`;
}

export function ReviewQueue({ initialItems }: ReviewQueueProps) {
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function act(item: ReviewItem, action: "import" | "dismiss" | "acknowledge") {
    setBusy(item.id);
    setError(null);
    try {
      await resolveReviewItem(item.id, action);
      setItems((xs) => xs.filter((x) => x.id !== item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 32, padding: 20 }}>
      <div className="section-label" style={{ marginBottom: 4 }}>Needs review</div>
      <p className="text-xs" style={{ color: "var(--text-tertiary)", marginBottom: 16, lineHeight: 1.5 }}>
        Items held for your decision so nothing is silently merged, double-counted, or dropped.
      </p>

      {error && (
        <div className="text-sm" style={{ color: "var(--danger, #c0392b)", marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((item) => {
          const isImport = item.type === "possible_duplicate_import";
          return (
            <div
              key={item.id}
              className="flex items-center justify-between"
              style={{ gap: 12, padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--surface-1)" }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="text-sm" style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                  <span className="badge-amber" style={{ marginRight: 8 }}>
                    {isImport ? "Possible duplicate" : "Removed (reconciled)"}
                  </span>
                  <span className="font-mono" style={{ fontSize: 13, color: "var(--text-secondary)" }}>{amountLabel(item.payload)}</span>
                </div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>{item.reason}</div>
              </div>
              <div className="flex" style={{ gap: 8, flexShrink: 0 }}>
                {isImport ? (
                  <button onClick={() => act(item, "import")} disabled={busy === item.id} style={btn("primary", busy === item.id)}>Import</button>
                ) : (
                  <button onClick={() => act(item, "acknowledge")} disabled={busy === item.id} style={btn("primary", busy === item.id)}>Acknowledge</button>
                )}
                <button onClick={() => act(item, "dismiss")} disabled={busy === item.id} style={btn("ghost", busy === item.id)}>Dismiss</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function btn(kind: "primary" | "ghost", disabled: boolean): React.CSSProperties {
  return {
    padding: "0 12px",
    height: 30,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    border: kind === "ghost" ? "1px solid var(--border-strong)" : "none",
    background: kind === "primary" ? "var(--accent)" : "transparent",
    color: kind === "primary" ? "var(--accent-contrast, #fff)" : "var(--text-secondary)",
    opacity: disabled ? 0.6 : 1,
  };
}
