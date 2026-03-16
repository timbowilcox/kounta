"use client";

import { useState, useTransition } from "react";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  fetchInvoices,
  fetchInvoiceSummary,
  fetchInvoice,
  createInvoiceAction,
  updateInvoiceAction,
  sendInvoiceAction,
  recordPaymentAction,
  voidInvoiceAction,
  deleteInvoiceAction,
} from "@/lib/actions";
import type {
  InvoiceListItem,
  InvoiceSummary,
  ARAgingBucket,
} from "@/lib/actions";
import type { AccountWithBalance } from "@kounta/sdk";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function plus30(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

function dollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars || "0") * 100);
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: "rgba(113,113,122,0.12)", text: "var(--text-tertiary)" },
  sent: { bg: "rgba(59,130,246,0.12)", text: "#3b82f6" },
  overdue: { bg: "rgba(239,68,68,0.12)", text: "var(--negative)" },
  partially_paid: { bg: "rgba(245,158,11,0.12)", text: "#D97706" },
  paid: { bg: "rgba(34,197,94,0.12)", text: "var(--positive)" },
  void: { bg: "rgba(113,113,122,0.08)", text: "var(--text-disabled)" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  const label = status === "partially_paid"
    ? "Partially Paid"
    : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        backgroundColor: c.bg,
        color: c.text,
        textDecoration: status === "void" ? "line-through" : undefined,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div
      style={{
        padding: "16px 20px",
        backgroundColor: "var(--surface-1)",
        border: `1px solid ${warn ? "color-mix(in srgb, var(--warning) 30%, transparent)" : "var(--border)"}`,
        borderRadius: 8,
        flex: 1,
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: warn ? "var(--warning)" : "var(--text-primary)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Label style
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-tertiary)",
  fontWeight: 500,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  backgroundColor: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: 13,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  initialInvoices: InvoiceListItem[];
  initialSummary: InvoiceSummary;
  initialAging: ARAgingBucket[];
  accounts: AccountWithBalance[];
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type StatusTab = "all" | "draft" | "sent" | "overdue" | "partially_paid" | "paid" | "void";
const TABS: { key: StatusTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "overdue", label: "Overdue" },
  { key: "partially_paid", label: "Partial" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
];

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function InvoicesView({ initialInvoices, initialSummary, initialAging, accounts }: Props) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [summary, setSummary] = useState(initialSummary);
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const [isPending, startTransition] = useTransition();

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [editInvoice, setEditInvoice] = useState<InvoiceListItem | null>(null);
  const [detailInvoice, setDetailInvoice] = useState<InvoiceListItem | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  const refresh = () => {
    startTransition(async () => {
      const [inv, sum] = await Promise.all([
        fetchInvoices(activeTab === "all" ? undefined : activeTab),
        fetchInvoiceSummary(),
      ]);
      setInvoices(inv);
      setSummary(sum);
    });
  };

  const handleTabChange = (tab: StatusTab) => {
    setActiveTab(tab);
    startTransition(async () => {
      const inv = await fetchInvoices(tab === "all" ? undefined : tab);
      setInvoices(inv);
    });
  };

  const handleRowClick = (inv: InvoiceListItem) => {
    startTransition(async () => {
      const detail = await fetchInvoice(inv.id);
      if (detail) setDetailInvoice(detail);
    });
  };

  const handleSend = (id: string) => {
    startTransition(async () => {
      const result = await sendInvoiceAction(id);
      if (result) {
        setDetailInvoice(result);
        refresh();
      }
    });
  };

  const handleVoid = (id: string) => {
    startTransition(async () => {
      const result = await voidInvoiceAction(id);
      if (result) {
        setDetailInvoice(result);
        refresh();
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const ok = await deleteInvoiceAction(id);
      if (ok) {
        setDetailInvoice(null);
        refresh();
      }
    });
  };

  const filtered = invoices;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Invoices</h1>
          <p style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 2 }}>
            Accounts receivable — create, send, and track payments
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          New invoice
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4" style={{ gap: 16, marginBottom: 24 }}>
        <StatCard
          label="Outstanding"
          value={formatCurrency(summary.totalOutstanding)}
          sub={`${summary.invoiceCount} invoice${summary.invoiceCount !== 1 ? "s" : ""}`}
        />
        <StatCard
          label="Overdue"
          value={formatCurrency(summary.totalOverdue)}
          sub={`${summary.overdueCount} overdue`}
          warn={summary.overdueCount > 0}
        />
        <StatCard
          label="Draft"
          value={formatCurrency(summary.totalDraft)}
        />
        <StatCard
          label="Paid this month"
          value={formatCurrency(summary.totalPaidThisMonth)}
          sub={summary.averageDaysToPayment != null ? `Avg ${Math.round(summary.averageDaysToPayment)} days to pay` : undefined}
        />
      </div>

      {/* Tabs */}
      <div className="flex" style={{ gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 0 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 500 : 400,
              color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-tertiary)",
              borderBottom: activeTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
              backgroundColor: "transparent",
              border: "none",
              borderBottomWidth: 2,
              borderBottomStyle: "solid",
              borderBottomColor: activeTab === tab.key ? "var(--accent)" : "transparent",
              cursor: "pointer",
              transition: "color 150ms ease",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, borderTop: "none", borderTopLeftRadius: 0, borderTopRightRadius: 0, opacity: isPending ? 0.6 : 1, transition: "opacity 150ms" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 12px" }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>No invoices</div>
            <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Create your first invoice to start tracking accounts receivable.</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Invoice #", "Customer", "Issue Date", "Due Date", "Total", "Amount Due", "Status"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 16px",
                      fontSize: 11,
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--text-tertiary)",
                      textAlign: h === "Total" || h === "Amount Due" ? "right" : "left",
                      position: "sticky",
                      top: 0,
                      backgroundColor: "var(--surface-1)",
                      zIndex: 1,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => handleRowClick(inv)}
                  style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", transition: "background-color 150ms" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--surface-1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                >
                  <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {inv.invoiceNumber}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--text-primary)" }}>{inv.customerName}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{formatDate(inv.issueDate)}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{formatDate(inv.dueDate)}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--text-primary)" }}>
                    {formatCurrency(inv.total)}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right", color: inv.amountDue > 0 && inv.status === "overdue" ? "var(--negative)" : "var(--text-primary)" }}>
                    {formatCurrency(inv.amountDue)}
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <StatusBadge status={inv.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit modal */}
      {(showCreate || editInvoice) && (
        <CreateInvoiceModal
          editInvoice={editInvoice}
          onClose={() => { setShowCreate(false); setEditInvoice(null); }}
          onCreated={(inv) => {
            setShowCreate(false);
            setEditInvoice(null);
            refresh();
            if (inv) setDetailInvoice(inv);
          }}
        />
      )}

      {/* Detail drawer */}
      {detailInvoice && (
        <InvoiceDetailDrawer
          invoice={detailInvoice}
          isPending={isPending}
          onClose={() => setDetailInvoice(null)}
          onSend={() => handleSend(detailInvoice.id)}
          onVoid={() => handleVoid(detailInvoice.id)}
          onDelete={() => handleDelete(detailInvoice.id)}
          onEdit={() => { setEditInvoice(detailInvoice); setDetailInvoice(null); }}
          onRecordPayment={() => setShowPayment(true)}
        />
      )}

      {/* Record payment modal */}
      {showPayment && detailInvoice && (
        <RecordPaymentModal
          invoice={detailInvoice}
          onClose={() => setShowPayment(false)}
          onRecorded={(updated) => {
            setShowPayment(false);
            if (updated) setDetailInvoice(updated);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create/Edit Invoice Modal
// ---------------------------------------------------------------------------

function CreateInvoiceModal({
  editInvoice,
  onClose,
  onCreated,
}: {
  editInvoice: InvoiceListItem | null;
  onClose: () => void;
  onCreated: (inv: InvoiceListItem | null) => void;
}) {
  const isEdit = !!editInvoice;

  const [customerName, setCustomerName] = useState(editInvoice?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(editInvoice?.customerEmail ?? "");
  const [issueDate, setIssueDate] = useState(editInvoice?.issueDate ?? todayISO());
  const [dueDate, setDueDate] = useState(editInvoice?.dueDate ?? plus30());
  const [notes, setNotes] = useState("");
  const [taxInclusive, setTaxInclusive] = useState(false);

  interface LineItemForm {
    description: string;
    quantity: string;
    unitPriceDollars: string;
  }

  const defaultLines: LineItemForm[] = editInvoice
    ? editInvoice.lineItems.map((li) => ({
        description: li.description,
        quantity: String(li.quantity),
        unitPriceDollars: centsToDollars(li.unitPrice),
      }))
    : [{ description: "", quantity: "1", unitPriceDollars: "" }];

  const [lineItems, setLineItems] = useState<LineItemForm[]>(defaultLines);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const addLine = () => setLineItems([...lineItems, { description: "", quantity: "1", unitPriceDollars: "" }]);
  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof LineItemForm, value: string) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: value };
    setLineItems(updated);
  };

  const subtotal = lineItems.reduce((sum, li) => {
    const qty = parseFloat(li.quantity) || 0;
    const price = dollarsToCents(li.unitPriceDollars);
    return sum + Math.round(qty * price);
  }, 0);

  const isValid = customerName.trim().length > 0 && lineItems.length > 0 &&
    lineItems.every((li) => li.description.trim() && parseFloat(li.quantity) > 0 && parseFloat(li.unitPriceDollars) > 0);

  const handleSubmit = (andSend: boolean) => {
    setError(null);
    startTransition(async () => {
      const input = {
        customerName,
        customerEmail: customerEmail || undefined,
        issueDate,
        dueDate,
        lineItems: lineItems.map((li) => ({
          description: li.description,
          quantity: parseFloat(li.quantity) || 1,
          unitPrice: dollarsToCents(li.unitPriceDollars),
        })),
        notes: notes || undefined,
        taxInclusive,
      };

      let result: InvoiceListItem | null;
      if (isEdit && editInvoice) {
        result = await updateInvoiceAction(editInvoice.id, input);
      } else {
        result = await createInvoiceAction(input);
      }

      if (!result) {
        setError("Failed to save invoice. Please check your inputs.");
        return;
      }

      if (andSend && result) {
        const sent = await sendInvoiceAction(result.id);
        onCreated(sent ?? result);
      } else {
        onCreated(result);
      }
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(4px)", zIndex: 100,
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: 640, maxHeight: "85vh", overflowY: "auto",
          backgroundColor: "var(--surface-1)", borderRadius: 8,
          border: "1px solid var(--border)", zIndex: 101,
          padding: 24,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>{isEdit ? "Edit Invoice" : "New Invoice"}</h2>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
              backgroundColor: "transparent", border: "none", borderRadius: 6,
              color: "var(--text-tertiary)", cursor: "pointer", fontSize: 16,
            }}
          >
            &#10005;
          </button>
        </div>

        {/* Customer */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Customer name *</label>
            <input style={inputStyle} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Acme Corp" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Customer email</label>
            <input style={inputStyle} value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="billing@acme.com" />
          </div>
        </div>

        {/* Dates */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Issue date</label>
            <input type="date" style={inputStyle} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Due date</label>
            <input type="date" style={inputStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        {/* Line items */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Line items</label>
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ display: "flex", backgroundColor: "var(--surface-2)", padding: "6px 10px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)" }}>
              <div style={{ flex: 3 }}>Description</div>
              <div style={{ width: 70, textAlign: "center" }}>Qty</div>
              <div style={{ width: 100, textAlign: "right" }}>Unit Price</div>
              <div style={{ width: 100, textAlign: "right" }}>Amount</div>
              <div style={{ width: 32 }} />
            </div>
            {/* Rows */}
            {lineItems.map((li, i) => {
              const amt = Math.round((parseFloat(li.quantity) || 0) * dollarsToCents(li.unitPriceDollars));
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", padding: "4px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
                  <div style={{ flex: 3, paddingRight: 8 }}>
                    <input
                      style={{ ...inputStyle, height: 32, backgroundColor: "transparent", border: "none" }}
                      value={li.description}
                      onChange={(e) => updateLine(i, "description", e.target.value)}
                      placeholder="Description"
                    />
                  </div>
                  <div style={{ width: 70, paddingRight: 8 }}>
                    <input
                      style={{ ...inputStyle, height: 32, backgroundColor: "transparent", border: "none", textAlign: "center" }}
                      value={li.quantity}
                      onChange={(e) => updateLine(i, "quantity", e.target.value)}
                    />
                  </div>
                  <div style={{ width: 100, paddingRight: 8 }}>
                    <input
                      style={{ ...inputStyle, height: 32, backgroundColor: "transparent", border: "none", textAlign: "right", fontFamily: "var(--font-mono)" }}
                      value={li.unitPriceDollars}
                      onChange={(e) => updateLine(i, "unitPriceDollars", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div style={{ width: 100, textAlign: "right", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                    {formatCurrency(amt)}
                  </div>
                  <div style={{ width: 32, textAlign: "center" }}>
                    {lineItems.length > 1 && (
                      <button
                        onClick={() => removeLine(i)}
                        style={{ background: "none", border: "none", color: "var(--text-disabled)", cursor: "pointer", fontSize: 14 }}
                      >
                        &#10005;
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={addLine}
            className="btn-ghost"
            style={{ marginTop: 8, fontSize: 12, height: 28, padding: "0 10px" }}
          >
            + Add line item
          </button>
        </div>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <div style={{ width: 200 }}>
            <div className="flex justify-between" style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
              <span>Subtotal</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", paddingTop: 6, borderTop: "1px solid var(--border)" }}>
              <span>Total</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{formatCurrency(subtotal)}</span>
            </div>
          </div>
        </div>

        {/* Options */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} />
            Prices include tax
          </label>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={{ ...inputStyle, height: 60, resize: "vertical", padding: 10 }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Visible on the invoice"
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "8px 12px", borderRadius: 6, backgroundColor: "rgba(239,68,68,0.1)", color: "var(--negative)", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end" style={{ gap: 8 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {isEdit ? (
            <button className="btn-primary" disabled={!isValid || isPending} onClick={() => handleSubmit(false)}>
              {isPending ? "Saving..." : "Update"}
            </button>
          ) : (
            <>
              <button className="btn-secondary" disabled={!isValid || isPending} onClick={() => handleSubmit(false)}>
                {isPending ? "Saving..." : "Save as draft"}
              </button>
              <button className="btn-primary" disabled={!isValid || isPending} onClick={() => handleSubmit(true)}>
                {isPending ? "Saving..." : "Save & send"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Invoice Detail Drawer
// ---------------------------------------------------------------------------

function InvoiceDetailDrawer({
  invoice,
  isPending,
  onClose,
  onSend,
  onVoid,
  onDelete,
  onEdit,
  onRecordPayment,
}: {
  invoice: InvoiceListItem;
  isPending: boolean;
  onClose: () => void;
  onSend: () => void;
  onVoid: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onRecordPayment: () => void;
}) {
  const isDraft = invoice.status === "draft";
  const canPay = ["sent", "overdue", "partially_paid"].includes(invoice.status);
  const canVoid = ["sent", "overdue"].includes(invoice.status);
  const isTerminal = ["paid", "void"].includes(invoice.status);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.3)", zIndex: 100 }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
          backgroundColor: "var(--surface-1)", borderLeft: "1px solid var(--border)",
          zIndex: 101, overflowY: "auto", padding: 24,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <div>
            <div className="flex items-center" style={{ gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 600, fontFamily: "var(--font-mono)" }}>{invoice.invoiceNumber}</span>
              <StatusBadge status={invoice.status} />
            </div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{invoice.customerName}</div>
            {invoice.customerEmail && <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{invoice.customerEmail}</div>}
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "none", borderRadius: 6, color: "var(--text-tertiary)", cursor: "pointer", fontSize: 16 }}
          >
            &#10005;
          </button>
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-3" style={{ gap: 12, marginBottom: 20 }}>
          <div style={{ padding: "12px 16px", backgroundColor: "var(--surface-2)", borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>Total</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "var(--font-mono)" }}>{formatCurrency(invoice.total)}</div>
          </div>
          <div style={{ padding: "12px 16px", backgroundColor: "var(--surface-2)", borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>Paid</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--positive)" }}>{formatCurrency(invoice.amountPaid)}</div>
          </div>
          <div style={{ padding: "12px 16px", backgroundColor: "var(--surface-2)", borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2 }}>Outstanding</div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "var(--font-mono)", color: invoice.status === "overdue" ? "var(--negative)" : "var(--text-primary)" }}>{formatCurrency(invoice.amountDue)}</div>
          </div>
        </div>

        {/* Actions */}
        {!isTerminal && (
          <div className="flex" style={{ gap: 8, marginBottom: 20 }}>
            {isDraft && (
              <>
                <button className="btn-secondary" onClick={onEdit} disabled={isPending}>Edit</button>
                <button className="btn-primary" onClick={onSend} disabled={isPending}>Send</button>
                <button
                  onClick={onDelete}
                  disabled={isPending}
                  style={{
                    height: 36, padding: "0 12px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                    backgroundColor: "transparent", border: "1px solid rgba(239,68,68,0.3)", color: "var(--negative)",
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </>
            )}
            {canPay && (
              <button className="btn-primary" onClick={onRecordPayment} disabled={isPending}>Record payment</button>
            )}
            {canVoid && (
              <button
                onClick={onVoid}
                disabled={isPending}
                style={{
                  height: 36, padding: "0 12px", borderRadius: 6, fontSize: 13, fontWeight: 500,
                  backgroundColor: "transparent", border: "1px solid rgba(239,68,68,0.3)", color: "var(--negative)",
                  cursor: "pointer",
                }}
              >
                Void
              </button>
            )}
          </div>
        )}

        {/* Dates */}
        <div className="flex" style={{ gap: 24, marginBottom: 20, fontSize: 13 }}>
          <div>
            <span style={{ color: "var(--text-tertiary)" }}>Issued: </span>
            <span style={{ color: "var(--text-secondary)" }}>{formatDate(invoice.issueDate)}</span>
          </div>
          <div>
            <span style={{ color: "var(--text-tertiary)" }}>Due: </span>
            <span style={{ color: "var(--text-secondary)" }}>{formatDate(invoice.dueDate)}</span>
          </div>
        </div>

        {/* Line items */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", marginBottom: 8 }}>Line Items</h3>
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "var(--surface-2)" }}>
                  <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "left" }}>Description</th>
                  <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "center" }}>Qty</th>
                  <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "right" }}>Price</th>
                  <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lineItems.map((li) => (
                  <tr key={li.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 12px", fontSize: 13 }}>{li.description}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "center", fontFamily: "var(--font-mono)" }}>{li.quantity}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)" }}>{formatCurrency(li.unitPrice)}</td>
                    <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)" }}>{formatCurrency(li.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment history */}
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", marginBottom: 8 }}>Payment History</h3>
          {invoice.payments.length === 0 ? (
            <div style={{ padding: "16px 12px", fontSize: 13, color: "var(--text-disabled)", border: "1px solid var(--border)", borderRadius: 6, textAlign: "center" }}>
              No payments recorded
            </div>
          ) : (
            <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--surface-2)" }}>
                    <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "left" }}>Date</th>
                    <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "right" }}>Amount</th>
                    <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "left" }}>Method</th>
                    <th style={{ padding: "6px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", textAlign: "left" }}>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.payments.map((p) => (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px", fontSize: 13 }}>{formatDate(p.paymentDate)}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--positive)" }}>{formatCurrency(p.amount)}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-secondary)" }}>{p.paymentMethod ?? "—"}</td>
                      <td style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>{p.reference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Record Payment Modal
// ---------------------------------------------------------------------------

function RecordPaymentModal({
  invoice,
  onClose,
  onRecorded,
}: {
  invoice: InvoiceListItem;
  onClose: () => void;
  onRecorded: (updated: InvoiceListItem | null) => void;
}) {
  const [amountDollars, setAmountDollars] = useState(centsToDollars(invoice.amountDue));
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const amountCents = dollarsToCents(amountDollars);
  const isValid = amountCents > 0 && amountCents <= invoice.amountDue && paymentDate;

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await recordPaymentAction(invoice.id, {
        amount: amountCents,
        paymentDate,
        paymentMethod: paymentMethod || undefined,
        reference: reference || undefined,
      });
      if (!result) {
        setError("Failed to record payment.");
        return;
      }
      onRecorded(result);
    });
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", zIndex: 200 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 420, backgroundColor: "var(--surface-1)", borderRadius: 8, border: "1px solid var(--border)", zIndex: 201, padding: 24 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Record Payment</h2>
          <button onClick={onClose} style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "transparent", border: "none", borderRadius: 6, color: "var(--text-tertiary)", cursor: "pointer", fontSize: 16 }}>&#10005;</button>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
          Invoice {invoice.invoiceNumber} &middot; {invoice.customerName} &middot; Due: {formatCurrency(invoice.amountDue)}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Amount</label>
          <div style={{ display: "flex" }}>
            <span style={{ height: 36, padding: "0 10px", display: "flex", alignItems: "center", backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", borderRight: "none", borderRadius: "6px 0 0 6px", fontSize: 13, color: "var(--text-tertiary)" }}>$</span>
            <input
              style={{ ...inputStyle, borderRadius: "0 6px 6px 0", fontFamily: "var(--font-mono)" }}
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Payment date</label>
          <input type="date" style={inputStyle} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Payment method</label>
          <select style={inputStyle} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="stripe">Stripe</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Reference</label>
          <input style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank ref or payment ID" />
        </div>

        {error && (
          <div style={{ padding: "8px 12px", borderRadius: 6, backgroundColor: "rgba(239,68,68,0.1)", color: "var(--negative)", fontSize: 13, marginBottom: 16 }}>{error}</div>
        )}

        <div className="flex justify-end" style={{ gap: 8 }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!isValid || isPending} onClick={handleSubmit}>
            {isPending ? "Recording..." : "Record payment"}
          </button>
        </div>
      </div>
    </>
  );
}
