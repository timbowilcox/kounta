// ---------------------------------------------------------------------------
// Payment Terms — configuration and due date calculation
// ---------------------------------------------------------------------------

export type PaymentTermsCode =
  | "due_on_receipt"
  | "net_7"
  | "net_14"
  | "net_15"
  | "net_30"
  | "net_45"
  | "net_60"
  | "net_90"
  | "custom";

export interface PaymentTermsConfig {
  readonly code: PaymentTermsCode;
  readonly label: string;
  readonly days: number | null; // null for due_on_receipt (0) and custom
}

export const PAYMENT_TERMS: readonly PaymentTermsConfig[] = [
  { code: "due_on_receipt", label: "Due on receipt", days: 0 },
  { code: "net_7", label: "Net 7", days: 7 },
  { code: "net_14", label: "Net 14", days: 14 },
  { code: "net_15", label: "Net 15", days: 15 },
  { code: "net_30", label: "Net 30", days: 30 },
  { code: "net_45", label: "Net 45", days: 45 },
  { code: "net_60", label: "Net 60", days: 60 },
  { code: "net_90", label: "Net 90", days: 90 },
  { code: "custom", label: "Custom", days: null },
];

/**
 * Calculate the due date from an issue date and payment terms code.
 *
 * For "custom" terms, returns the issue date (caller should provide their own due date).
 * For "due_on_receipt", returns the issue date.
 * For "net_N", adds N days to the issue date.
 */
export const calculateDueDate = (
  issueDate: string,
  paymentTerms: PaymentTermsCode,
): string => {
  const config = PAYMENT_TERMS.find((t) => t.code === paymentTerms);
  if (!config || config.days === null) return issueDate;

  const date = new Date(issueDate);
  date.setDate(date.getDate() + config.days);
  return date.toISOString().slice(0, 10);
};

/**
 * Get the display label for a payment terms code.
 */
export const getPaymentTermsLabel = (code: string): string => {
  const config = PAYMENT_TERMS.find((t) => t.code === code);
  return config?.label ?? code;
};
