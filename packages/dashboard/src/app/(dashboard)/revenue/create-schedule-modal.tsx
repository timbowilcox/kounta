"use client";

import { useState, useTransition } from "react";
import { createRevenueScheduleAction } from "@/lib/actions";
import type { AccountWithBalance } from "@kounta/sdk";

interface Props {
  accounts: AccountWithBalance[];
  onClose: () => void;
  onCreated: () => void;
}

export function CreateScheduleModal({ accounts, onClose, onCreated }: Props) {
  const [customerName, setCustomerName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const revenueAccounts = accounts.filter((a) => a.type === "revenue");
  const liabilityAccounts = accounts.filter((a) => a.type === "liability");

  const handleSubmit = () => {
    setError(null);

    const cents = Math.round(parseFloat(amount) * 100);
    if (!cents || cents <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    if (!startDate || !endDate) {
      setError("Please select start and end dates.");
      return;
    }
    if (endDate <= startDate) {
      setError("End date must be after start date.");
      return;
    }

    startTransition(async () => {
      const result = await createRevenueScheduleAction({
        totalAmount: cents,
        recognitionStart: startDate,
        recognitionEnd: endDate,
        customerName: customerName || undefined,
        description: description || undefined,
      });

      if (!result) {
        setError("Failed to create schedule. Please try again.");
        return;
      }

      onCreated();
      onClose();
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
          zIndex: 100,
          animation: "modal-fade-in 150ms ease",
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 520,
          maxHeight: "80vh",
          backgroundColor: "#FFFFFF",
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.12)",
          zIndex: 101,
          overflow: "auto",
          animation: "modal-slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: "16px 20px", borderBottom: "1px solid #E5E5E5" }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A" }}>Create Revenue Schedule</h2>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              border: "none",
              backgroundColor: "transparent",
              cursor: "pointer",
              color: "#999999",
              fontSize: 16,
            }}
          >
            &#10005;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 13, color: "#666666", margin: 0 }}>
            Create a manual revenue recognition schedule. Revenue will be spread
            evenly across the service period.
          </p>

          {/* Customer name */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#666666", marginBottom: 4, display: "block" }}>
              Customer name
            </label>
            <input
              className="input w-full"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Acme Corp"
            />
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#666666", marginBottom: 4, display: "block" }}>
              Description
            </label>
            <input
              className="input w-full"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Annual subscription"
            />
          </div>

          {/* Amount */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: "#666666", marginBottom: 4, display: "block" }}>
              Total amount
            </label>
            <div className="flex items-center" style={{ gap: 0 }}>
              <span
                style={{
                  height: 36,
                  padding: "0 10px",
                  display: "flex",
                  alignItems: "center",
                  backgroundColor: "#F5F5F5",
                  border: "1px solid #E5E5E5",
                  borderRight: "none",
                  borderRadius: "6px 0 0 6px",
                  fontSize: 13,
                  color: "#666666",
                }}
              >
                $
              </span>
              <input
                className="input"
                style={{ borderRadius: "0 6px 6px 0", flex: 1 }}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1,200.00"
                type="number"
                step="0.01"
                min="0"
              />
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2" style={{ gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: "#666666", marginBottom: 4, display: "block" }}>
                Recognition start
              </label>
              <input
                className="input w-full"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: "#666666", marginBottom: 4, display: "block" }}>
                Recognition end
              </label>
              <input
                className="input w-full"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Account info */}
          {(revenueAccounts.length > 0 || liabilityAccounts.length > 0) && (
            <div style={{ fontSize: 12, color: "#999999", backgroundColor: "#FAFAFA", padding: "8px 12px", borderRadius: 6, border: "1px solid #F0F0F0" }}>
              Revenue will be recognised to{" "}
              <strong style={{ color: "#666666" }}>
                {revenueAccounts.find((a) => a.code === "4000")?.name ?? revenueAccounts[0]?.name ?? "Subscription Revenue"}
              </strong>{" "}
              via{" "}
              <strong style={{ color: "#666666" }}>
                {liabilityAccounts.find((a) => a.code === "2500")?.name ?? "Deferred Revenue"}
              </strong>.
              Accounts will be auto-created if they don&apos;t exist.
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ backgroundColor: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#DC2626" }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end" style={{ padding: "12px 20px", borderTop: "1px solid #E5E5E5", gap: 8 }}>
          <button onClick={onClose} className="btn-secondary" style={{ height: 34, padding: "0 14px", fontSize: 13 }}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="btn-primary"
            style={{ height: 34, padding: "0 14px", fontSize: 13 }}
            disabled={isPending || !amount || !startDate || !endDate}
          >
            {isPending ? "Creating..." : "Create schedule"}
          </button>
        </div>
      </div>
    </>
  );
}
