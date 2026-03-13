"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchClassificationStats, markBankTransactionPersonal } from "@/lib/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UnclassifiedTransaction {
  id: string;
  amount: number;
  description: string;
  date: string;
}

interface ClassificationModalProps {
  ledgerId: string;
  currency: string;
}

const CATEGORY_SUGGESTIONS = [
  { label: "Software Tools", color: "#0066FF" },
  { label: "Marketing", color: "#8B5CF6" },
  { label: "Infrastructure", color: "#06B6D4" },
  { label: "Personal — exclude", color: "#EF4444" },
];

// ---------------------------------------------------------------------------
// First Classification Modal
//
// Shows after the first bank feed sync when there are unclassified
// transactions. Cards slide up as the user classifies each one.
// ---------------------------------------------------------------------------

export function FirstClassificationModal({ ledgerId, currency }: ClassificationModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<{ total: number; classified: number; unclassified: number } | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [classifiedCount, setClassifiedCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);

  // Check if we should show the modal
  useEffect(() => {
    const storageKey = `ledge_classification_modal_${ledgerId}`;
    const wasDismissed = typeof window !== "undefined" && localStorage.getItem(storageKey);
    if (wasDismissed) return;

    fetchClassificationStats()
      .then((s) => {
        setStats(s);
        // Show modal if there are unclassified transactions
        if (s.unclassified > 3) {
          setIsOpen(true);
        }
      })
      .catch(() => {});
  }, [ledgerId]);

  const handleClassify = useCallback((category: string, bankTxnId?: string) => {
    // If marked as personal, call the mark-personal endpoint
    if ((category === "Personal — exclude" || category === "personal") && bankTxnId) {
      markBankTransactionPersonal(bankTxnId).catch(() => {});
    }
    setClassifiedCount((c) => c + 1);
    // Animate to next card
    setTimeout(() => {
      setCurrentIndex((i) => i + 1);
    }, 300);
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      localStorage.setItem(`ledge_classification_modal_${ledgerId}`, "dismissed");
    }
    // Show snapshot if some were classified
    if (classifiedCount > 0) {
      setShowSnapshot(true);
    } else {
      setIsOpen(false);
    }
  }, [ledgerId, classifiedCount]);

  const handleFinish = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(`ledge_classification_modal_${ledgerId}`, "dismissed");
    }
    setShowSnapshot(true);
  }, [ledgerId]);

  if (!isOpen || !stats) return null;

  const unclassifiedTotal = stats.unclassified;
  const isComplete = currentIndex >= unclassifiedTotal || dismissed;

  if (showSnapshot) {
    return (
      <ModalOverlay>
        <FinancialSnapshot onClose={() => setIsOpen(false)} />
      </ModalOverlay>
    );
  }

  if (isComplete && classifiedCount > 0) {
    return (
      <ModalOverlay>
        <FinancialSnapshot onClose={() => setIsOpen(false)} />
      </ModalOverlay>
    );
  }

  return (
    <ModalOverlay>
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 16,
          padding: 32,
          maxWidth: 520,
          width: "100%",
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0A0A0A", marginBottom: 8 }}>
            I pulled in {stats.total} transactions from the last 30 days.
          </h2>
          <p style={{ fontSize: 14, color: "#666666" }}>
            I recognised {stats.classified} automatically.
            Here are {unclassifiedTotal} that need your input.
          </p>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#999999" }}>
              {classifiedCount} of {unclassifiedTotal} classified
            </span>
          </div>
          <div
            style={{
              height: 4,
              backgroundColor: "#E5E5E5",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(classifiedCount / Math.max(unclassifiedTotal, 1)) * 100}%`,
                backgroundColor: "#0066FF",
                borderRadius: 2,
                transition: "width 300ms ease",
              }}
            />
          </div>
        </div>

        {/* Transaction card placeholder */}
        {currentIndex < unclassifiedTotal && (
          <TransactionCard
            index={currentIndex}
            onClassify={handleClassify}
          />
        )}

        {/* Dismiss link */}
        <button
          onClick={handleDismiss}
          style={{
            display: "block",
            margin: "20px auto 0",
            padding: "8px 16px",
            border: "none",
            backgroundColor: "transparent",
            color: "#999999",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          I&apos;ll do this later &rarr;
        </button>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------------
// Transaction Card
// ---------------------------------------------------------------------------

function TransactionCard({
  index,
  onClassify,
}: {
  index: number;
  onClassify: (category: string, bankTxnId?: string) => void;
}) {
  // Mock transaction data for display
  const mockTransactions = [
    { id: "mock-1", amount: 4299, description: "NOTION.SO", date: "Mar 8" },
    { id: "mock-2", amount: 2000, description: "VERCEL INC", date: "Mar 7" },
    { id: "mock-3", amount: 999, description: "SPOTIFY", date: "Mar 6" },
    { id: "mock-4", amount: 14999, description: "AWS SERVICES", date: "Mar 5" },
    { id: "mock-5", amount: 4999, description: "FIGMA INC", date: "Mar 4" },
  ];

  const tx = mockTransactions[index % mockTransactions.length];

  return (
    <div
      style={{
        padding: 20,
        borderRadius: 12,
        border: "1px solid #E5E5E5",
        backgroundColor: "#FAFAFA",
        animation: "slideUp 200ms ease forwards",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0A0A0A" }}>
            {tx.description}
          </div>
          <div style={{ fontSize: 12, color: "#999999", marginTop: 2 }}>{tx.date}</div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#0A0A0A", fontFamily: "monospace" }}>
          ${(tx.amount / 100).toFixed(2)}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CATEGORY_SUGGESTIONS.map((cat) => (
          <button
            key={cat.label}
            onClick={() => onClassify(cat.label, tx.id)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `1px solid ${cat.color}20`,
              backgroundColor: `${cat.color}08`,
              color: cat.color,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 150ms ease",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = `${cat.color}15`;
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = `${cat.color}08`;
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Financial Snapshot (shown after classification or dismissal)
// ---------------------------------------------------------------------------

function FinancialSnapshot({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: 16,
        padding: 32,
        maxWidth: 440,
        width: "100%",
        textAlign: "center",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0A0A0A", marginBottom: 20 }}>
        Your financial snapshot
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 28,
        }}
      >
        <SnapshotCard label="Revenue" value="$0.00" color="#22C55E" />
        <SnapshotCard label="Expenses" value="$0.00" color="#EF4444" />
        <SnapshotCard label="Net Income" value="$0.00" color="#0066FF" />
        <SnapshotCard label="Cash Balance" value="$0.00" color="#8B5CF6" />
      </div>

      <button
        onClick={onClose}
        style={{
          padding: "12px 24px",
          borderRadius: 10,
          border: "none",
          backgroundColor: "#0066FF",
          color: "#FFFFFF",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          width: "100%",
        }}
      >
        Go to dashboard &rarr;
      </button>
    </div>
  );
}

function SnapshotCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: "1px solid #E5E5E5",
        backgroundColor: "#FAFAFA",
        textAlign: "left",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "#999999", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "monospace" }}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal Overlay
// ---------------------------------------------------------------------------

function ModalOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}
