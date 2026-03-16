// ---------------------------------------------------------------------------
// Invoice email template — sent when an invoice is approved and emailed
// to the customer. Clean HTML matching the Kounta email design system.
// ---------------------------------------------------------------------------

import { formatAmount } from "./layout.js";

export interface InvoiceEmailData {
  readonly invoiceNumber: string;
  readonly customerName: string;
  readonly total: number;
  readonly currency: string;
  readonly dueDate: string;
  readonly businessName: string;
  readonly notes?: string;
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
};

/** Generate the HTML body content for an invoice email. */
export const generateInvoiceEmail = (data: InvoiceEmailData): string => {
  const notesBlock = data.notes
    ? `<hr style="border: none; border-top: 1px solid #E5E5E5; margin: 24px 0;" /><p style="font-size: 13px; color: #666666; margin: 0;">${escapeHtml(data.notes)}</p>`
    : "";

  return `
<h1 style="font-size: 18px; font-weight: 600; color: #0A0A0A; margin: 0 0 16px;">Invoice ${escapeHtml(data.invoiceNumber)}</h1>

<p style="font-size: 14px; color: #0A0A0A; line-height: 1.6; margin: 0 0 12px;">
  Hi ${escapeHtml(data.customerName)},
</p>

<p style="font-size: 14px; color: #0A0A0A; line-height: 1.6; margin: 0 0 20px;">
  Please find attached invoice <strong>${escapeHtml(data.invoiceNumber)}</strong> for
  <strong style="font-variant-numeric: tabular-nums;">${formatAmount(data.total, data.currency)}</strong>.
</p>

<table style="width: 100%; border-collapse: collapse; margin: 0 0 20px;">
  <tr>
    <td style="padding: 10px 0; font-size: 13px; color: #666666; border-bottom: 1px solid #E5E5E5;">Due Date</td>
    <td style="padding: 10px 0; font-size: 13px; color: #0A0A0A; text-align: right; font-weight: 600; border-bottom: 1px solid #E5E5E5;">${fmtDate(data.dueDate)}</td>
  </tr>
  <tr>
    <td style="padding: 10px 0; font-size: 13px; color: #666666;">Amount Due</td>
    <td style="padding: 10px 0; font-size: 13px; color: #0A0A0A; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums;">${formatAmount(data.total, data.currency)}</td>
  </tr>
</table>

${notesBlock}

<p style="font-size: 14px; color: #0A0A0A; line-height: 1.6; margin: 24px 0 4px;">
  Thank you for your business.
</p>
<p style="font-size: 14px; color: #666666; margin: 0;">
  ${escapeHtml(data.businessName)}
</p>
`.trim();
};

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
