"use client";

import { useState, useTransition, useRef, useCallback } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import { fetchTransactions, fetchBankTransactions, markBankTransactionPersonal, fetchAttachments, uploadAttachment, deleteAttachmentAction } from "@/lib/actions";
import type { BankTransactionSummary, AttachmentSummary } from "@/lib/actions";
import type { TransactionWithLines, PaginatedResult, AccountWithBalance } from "@ledge/sdk";
import { ContextualPrompt } from "@/components/contextual-prompt";
import { usePostTransaction } from "@/components/post-transaction-provider";

interface Props {
  initialData: PaginatedResult<TransactionWithLines>;
  accountMap: Record<string, { code: string; name: string }>;
}

type StatusFilter = "all" | "posted" | "reversed";

export function TransactionsView({ initialData, accountMap }: Props) {
  const [data, setData] = useState(initialData);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [cursors, setCursors] = useState<string[]>([]);
  const [showPersonal, setShowPersonal] = useState(false);
  const [personalTxns, setPersonalTxns] = useState<BankTransactionSummary[]>([]);
  const [loadingPersonal, startPersonalTransition] = useTransition();
  const { open: openPostTransaction } = usePostTransaction();

  const filtered = data.data.filter((tx) => {
    if (filter !== "all" && tx.status !== filter) return false;
    if (search && !tx.memo.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const loadNext = () => {
    if (!data.nextCursor) return;
    startTransition(async () => {
      const result = await fetchTransactions(data.nextCursor ?? undefined, 50);
      setCursors([...cursors, ""]);
      setData(result);
    });
  };

  const txAmount = (tx: TransactionWithLines) =>
    tx.lines.filter((l) => l.direction === "debit").reduce((sum, l) => sum + l.amount, 0);

  const togglePersonal = () => {
    const next = !showPersonal;
    setShowPersonal(next);
    if (next && personalTxns.length === 0) {
      startPersonalTransition(async () => {
        const result = await fetchBankTransactions("personal", 100);
        setPersonalTxns(result);
      });
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#0A0A0A" }}>
          Transactions
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <ContextualPrompt placeholder="Search or ask about transactions..." />
          <button className="btn-primary" onClick={openPostTransaction} style={{ gap: 6, display: "inline-flex", alignItems: "center" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M7 2v10M2 7h10" />
            </svg>
            Post transaction
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="flex items-center" style={{ gap: 12, marginBottom: 24 }}>
        <input
          type="text"
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Search transactions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex" style={{ gap: 4 }}>
          {(["all", "posted", "reversed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className="capitalize"
              style={{
                padding: "0 12px",
                height: 32,
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                backgroundColor: filter === s ? "#F0F6FF" : "transparent",
                color: filter === s ? "#0066FF" : "#999999",
                border: filter === s ? "1px solid rgba(0,102,255,0.2)" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
            >
              {s}
            </button>
          ))}
          <div style={{ width: 1, height: 20, backgroundColor: "#E5E5E5", margin: "0 8px" }} />
          <button
            onClick={togglePersonal}
            style={{
              padding: "0 12px",
              height: 32,
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              backgroundColor: showPersonal ? "rgba(220,38,38,0.08)" : "transparent",
              color: showPersonal ? "#DC2626" : "#999999",
              border: showPersonal ? "1px solid rgba(220,38,38,0.15)" : "1px solid transparent",
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
          >
            {loadingPersonal ? "Loading..." : "Personal"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header" style={{ width: 120, position: "sticky", top: 0, zIndex: 1 }}>Date</th>
              <th className="table-header" style={{ position: "sticky", top: 0, zIndex: 1 }}>Description</th>
              <th className="table-header text-right" style={{ width: 140, position: "sticky", top: 0, zIndex: 1 }}>Amount</th>
              <th className="table-header text-right" style={{ width: 100, position: "sticky", top: 0, zIndex: 1 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                amount={txAmount(tx)}
                accountMap={accountMap}
                isExpanded={expandedId === tx.id}
                onToggle={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="table-cell text-center" style={{ padding: 48 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, maxWidth: 320, margin: "0 auto" }}>
                    <div style={{ marginBottom: 8 }}>
                      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#D4D4D4" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M8 14h32M8 24h32M8 34h20" />
                      </svg>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#0A0A0A" }}>No transactions found</div>
                    <div style={{ fontSize: 13, color: "#999999", marginBottom: 4 }}>
                      {search || filter !== "all" ? "Try adjusting your search or filters." : "Post your first transaction to see it here."}
                    </div>
                    {!search && filter === "all" && (
                      <button
                        className="btn-primary"
                        onClick={openPostTransaction}
                        style={{ marginTop: 8 }}
                      >
                        Post transaction
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.nextCursor && (
        <div className="flex justify-end" style={{ marginTop: 16 }}>
          <button
            className="btn-secondary"
            style={{ fontSize: 12 }}
            onClick={loadNext}
            disabled={isPending}
          >
            {isPending ? "Loading..." : "Load more"}
          </button>
        </div>
      )}

      {/* Personal bank transactions */}
      {showPersonal && (
        <div style={{ marginTop: 32 }}>
          <div className="section-label" style={{ marginBottom: 12 }}>
            Personal Transactions
            <span style={{ fontWeight: 400, color: "#999999", marginLeft: 8 }}>
              ({personalTxns.length} excluded from ledger)
            </span>
          </div>
          <div className="card" style={{ padding: 0, opacity: loadingPersonal ? 0.5 : 1 }}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header" style={{ width: 120 }}>Date</th>
                  <th className="table-header">Description</th>
                  <th className="table-header text-right" style={{ width: 140 }}>Amount</th>
                  <th className="table-header text-right" style={{ width: 100 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {personalTxns.map((txn) => (
                  <tr key={txn.id} className="table-row">
                    <td className="table-cell font-mono" style={{ fontSize: 13, color: "rgba(0,0,0,0.36)" }}>
                      {formatDate(txn.date)}
                    </td>
                    <td className="table-cell" style={{ fontSize: 13, color: "rgba(0,0,0,0.36)", fontWeight: 500 }}>
                      {txn.description}
                      <span
                        style={{
                          display: "inline-block",
                          marginLeft: 8,
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 600,
                          backgroundColor: "rgba(220,38,38,0.08)",
                          color: "#DC2626",
                        }}
                      >
                        Personal
                      </span>
                    </td>
                    <td className="table-cell text-right font-mono" style={{ fontSize: 13, color: "rgba(0,0,0,0.36)" }}>
                      {formatCurrency(Math.abs(txn.amount))}
                    </td>
                    <td className="table-cell text-right">
                      <span className="badge badge-red">ignored</span>
                    </td>
                  </tr>
                ))}
                {personalTxns.length === 0 && !loadingPersonal && (
                  <tr>
                    <td colSpan={4} className="table-cell text-center" style={{ padding: 32, color: "#999999", fontSize: 13 }}>
                      No personal transactions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TransactionRow({
  tx,
  amount,
  accountMap,
  isExpanded,
  onToggle,
}: {
  tx: TransactionWithLines;
  amount: number;
  accountMap: Record<string, { code: string; name: string }>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="table-row cursor-pointer" onClick={onToggle}>
        <td className="table-cell font-mono" style={{ fontSize: 13, color: "#666666" }}>{formatDate(tx.date)}</td>
        <td className="table-cell" style={{ fontSize: 13, color: "#0A0A0A", fontWeight: 500 }}>{tx.memo}</td>
        <td className="table-cell text-right font-mono" style={{ fontSize: 13, color: amount < 0 ? "#DC2626" : undefined }}>
          {formatCurrency(amount)}
        </td>
        <td className="table-cell text-right">
          <span className={"badge " + (tx.status === "posted" ? "badge-green" : "badge-red")}>
            {tx.status}
          </span>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={4} style={{ padding: 0 }}>
            <div
              style={{
                margin: "0 16px 12px",
                borderRadius: 8,
                backgroundColor: "#FAFAFA",
                border: "1px solid #E5E5E5",
              }}
            >
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header" style={{ fontSize: 12, paddingTop: 12, paddingBottom: 12 }}>Account</th>
                    <th className="table-header text-right" style={{ fontSize: 12, paddingTop: 12, paddingBottom: 12, width: 120 }}>Debit</th>
                    <th className="table-header text-right" style={{ fontSize: 12, paddingTop: 12, paddingBottom: 12, width: 120 }}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {tx.lines.map((line, i) => {
                    const acct = accountMap[line.accountId];
                    return (
                      <tr key={i}>
                        <td className="table-cell" style={{ fontSize: 13, paddingTop: 8, paddingBottom: 8 }}>
                          {acct && (
                            <code className="font-mono" style={{ fontSize: 12, color: "#999999", marginRight: 8 }}>
                              {acct.code}
                            </code>
                          )}
                          <span>{acct?.name ?? line.accountId}</span>
                        </td>
                        <td className="table-cell text-right font-mono" style={{ fontSize: 13, paddingTop: 8, paddingBottom: 8 }}>
                          {line.direction === "debit" ? formatCurrency(line.amount) : ""}
                        </td>
                        <td className="table-cell text-right font-mono" style={{ fontSize: 13, paddingTop: 8, paddingBottom: 8 }}>
                          {line.direction === "credit" ? formatCurrency(line.amount) : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Attachments */}
              <AttachmentsSection transactionId={tx.id} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Attachments section — shown inside expanded transaction row
// ---------------------------------------------------------------------------

function AttachmentsSection({ transactionId }: { transactionId: string }) {
  const [attachments, setAttachments] = useState<AttachmentSummary[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasFetched = useRef(false);

  // Fetch on first render
  const loadAttachments = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    const result = await fetchAttachments(transactionId);
    setAttachments(result);
  }, [transactionId]);

  // Trigger fetch
  if (!hasFetched.current) {
    loadAttachments();
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadAttachment(transactionId, formData);
      if (result) {
        setAttachments((prev) => [...(prev ?? []), result]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (attachmentId: string) => {
    setDeletingId(attachmentId);
    const ok = await deleteAttachmentAction(attachmentId);
    if (ok) {
      setAttachments((prev) => (prev ?? []).filter((a) => a.id !== attachmentId));
    }
    setDeletingId(null);
  };

  const isImage = (mime: string) => mime.startsWith("image/");

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid #E5E5E5" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#666666", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Attachments
          {attachments && attachments.length > 0 && (
            <span style={{ fontWeight: 400, color: "#999999", marginLeft: 4 }}>({attachments.length})</span>
          )}
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            backgroundColor: "#F0F6FF",
            color: "#0066FF",
            border: "1px solid rgba(0,102,255,0.2)",
            cursor: uploading ? "wait" : "pointer",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6 2v8M2 6h8" />
          </svg>
          {uploading ? "Uploading..." : "Attach receipt"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          style={{ display: "none" }}
          onChange={handleUpload}
        />
      </div>

      {/* Loading state */}
      {attachments === null && (
        <div style={{ fontSize: 12, color: "#999999", padding: "8px 0" }}>Loading attachments...</div>
      )}

      {/* Empty state */}
      {attachments && attachments.length === 0 && (
        <div style={{ fontSize: 12, color: "#999999", padding: "8px 0" }}>
          No receipts or documents attached.
        </div>
      )}

      {/* Attachment cards */}
      {attachments && attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {attachments.map((att) => (
            <div
              key={att.id}
              style={{
                position: "relative",
                width: 120,
                borderRadius: 8,
                border: "1px solid #E5E5E5",
                backgroundColor: "#FFFFFF",
                overflow: "hidden",
              }}
            >
              {/* Thumbnail / icon */}
              <a
                href={att.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", width: 120, height: 80, backgroundColor: "#F5F5F5", cursor: "pointer" }}
              >
                {isImage(att.mimeType) ? (
                  <img
                    src={att.downloadUrl}
                    alt={att.filename}
                    style={{ width: 120, height: 80, objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 120, height: 80 }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#DC2626" strokeWidth="1.2" strokeLinecap="round">
                      <rect x="6" y="3" width="16" height="22" rx="2" />
                      <path d="M10 10h8M10 14h8M10 18h4" />
                    </svg>
                  </div>
                )}
              </a>

              {/* Filename + size */}
              <div style={{ padding: "6px 8px" }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#0A0A0A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={att.filename}>
                  {att.filename}
                </div>
                <div style={{ fontSize: 10, color: "#999999" }}>{formatBytes(att.sizeBytes)}</div>
              </div>

              {/* Delete button */}
              <button
                onClick={() => handleDelete(att.id)}
                disabled={deletingId === att.id}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  color: "#FFFFFF",
                  border: "none",
                  cursor: deletingId === att.id ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  lineHeight: 1,
                  opacity: deletingId === att.id ? 0.5 : 1,
                }}
                title="Remove attachment"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
