// ---------------------------------------------------------------------------
// Invoice PDF generation — clean, professional invoice documents.
//
// Uses PDFKit to generate professional invoices matching the style of
// Stripe/Xero invoices: black text, subtle grey lines, no colour.
// ---------------------------------------------------------------------------

import PDFDocument from "pdfkit";
import type { Invoice } from "./types.js";
import { formatAmount } from "../email/templates/layout.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface InvoicePDFConfig {
  readonly businessName: string;
  readonly businessAddress?: string;
  readonly businessEmail?: string;
  readonly businessPhone?: string;
  readonly taxId?: string;
  readonly taxIdLabel?: string;
  readonly jurisdiction: string;
  readonly currencySymbol: string;
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GREY = "#666666";
const LIGHT_GREY = "#E5E5E5";
const ALT_ROW = "#F9FAFB";
const BLACK = "#0A0A0A";

const fmt = (amount: number, currency: string): string =>
  formatAmount(amount, currency);

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const statusLabel = (status: string): string => {
  if (status === "partially_paid") return "PARTIALLY PAID";
  return status.toUpperCase();
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export const generateInvoicePDF = (
  invoice: Invoice,
  config: InvoicePDFConfig,
): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `Invoice ${invoice.invoiceNumber}`,
          Author: config.businessName,
          Subject: `Invoice for ${invoice.customerName}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const leftX = doc.page.margins.left;
      const rightX = doc.page.width - doc.page.margins.right;

      // -----------------------------------------------------------------------
      // Header: Business info (left) + Invoice heading (right)
      // -----------------------------------------------------------------------

      let y = doc.page.margins.top;

      // Business name
      doc.font("Helvetica-Bold").fontSize(16).fillColor(BLACK)
        .text(config.businessName, leftX, y, { width: pageWidth / 2 });
      y = doc.y;

      // Tax ID
      if (config.taxId && config.taxIdLabel) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(`${config.taxIdLabel}: ${config.taxId}`, leftX, y, { width: pageWidth / 2 });
        y = doc.y;
      }

      // Business address, email, phone
      if (config.businessAddress) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(config.businessAddress, leftX, y, { width: pageWidth / 2 });
        y = doc.y;
      }
      if (config.businessEmail) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(config.businessEmail, leftX, y, { width: pageWidth / 2 });
        y = doc.y;
      }
      if (config.businessPhone) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(config.businessPhone, leftX, y, { width: pageWidth / 2 });
        y = doc.y;
      }

      // Right side: INVOICE heading
      const headerY = doc.page.margins.top;
      doc.font("Helvetica-Bold").fontSize(24).fillColor(BLACK)
        .text("INVOICE", leftX + pageWidth / 2, headerY, { width: pageWidth / 2, align: "right" });

      let rightY = headerY + 32;

      // Invoice number
      doc.font("Helvetica").fontSize(9).fillColor(GREY)
        .text("Invoice No.", leftX + pageWidth / 2, rightY, { width: pageWidth / 2 - 80, align: "right" });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK)
        .text(invoice.invoiceNumber, rightX - 78, rightY, { width: 78, align: "right" });
      rightY += 14;

      // Issue date
      doc.font("Helvetica").fontSize(9).fillColor(GREY)
        .text("Issue Date", leftX + pageWidth / 2, rightY, { width: pageWidth / 2 - 80, align: "right" });
      doc.font("Helvetica").fontSize(9).fillColor(BLACK)
        .text(fmtDate(invoice.issueDate), rightX - 78, rightY, { width: 78, align: "right" });
      rightY += 14;

      // Due date
      doc.font("Helvetica").fontSize(9).fillColor(GREY)
        .text("Due Date", leftX + pageWidth / 2, rightY, { width: pageWidth / 2 - 80, align: "right" });
      doc.font("Helvetica").fontSize(9).fillColor(BLACK)
        .text(fmtDate(invoice.dueDate), rightX - 78, rightY, { width: 78, align: "right" });
      rightY += 14;

      // Status
      doc.font("Helvetica").fontSize(9).fillColor(GREY)
        .text("Status", leftX + pageWidth / 2, rightY, { width: pageWidth / 2 - 80, align: "right" });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK)
        .text(statusLabel(invoice.status), rightX - 78, rightY, { width: 78, align: "right" });

      // -----------------------------------------------------------------------
      // Divider
      // -----------------------------------------------------------------------

      const afterHeader = Math.max(y, rightY) + 24;
      doc.moveTo(leftX, afterHeader).lineTo(rightX, afterHeader)
        .strokeColor(LIGHT_GREY).lineWidth(1).stroke();

      // -----------------------------------------------------------------------
      // Bill To
      // -----------------------------------------------------------------------

      let billY = afterHeader + 16;
      doc.font("Helvetica").fontSize(9).fillColor(GREY)
        .text("BILL TO", leftX, billY, { width: pageWidth / 2 });
      billY += 14;

      doc.font("Helvetica-Bold").fontSize(10).fillColor(BLACK)
        .text(invoice.customerName, leftX, billY, { width: pageWidth / 2 });
      billY = doc.y;

      if (invoice.customerEmail) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(invoice.customerEmail, leftX, billY, { width: pageWidth / 2 });
        billY = doc.y;
      }
      if (invoice.customerAddress) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(invoice.customerAddress, leftX, billY, { width: pageWidth / 2 });
        billY = doc.y;
      }

      // -----------------------------------------------------------------------
      // Line Items Table
      // -----------------------------------------------------------------------

      let tableY = billY + 24;

      // Column widths
      const colDesc = pageWidth * 0.48;
      const colQty = pageWidth * 0.12;
      const colPrice = pageWidth * 0.20;
      const colAmt = pageWidth * 0.20;
      const rowHeight = 24;

      // Header row
      doc.rect(leftX, tableY, pageWidth, rowHeight).fill("#F3F4F6");
      const headerTextY = tableY + 7;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY);
      doc.text("DESCRIPTION", leftX + 8, headerTextY, { width: colDesc - 8 });
      doc.text("QTY", leftX + colDesc, headerTextY, { width: colQty, align: "center" });
      doc.text("UNIT PRICE", leftX + colDesc + colQty, headerTextY, { width: colPrice, align: "right" });
      doc.text("AMOUNT", leftX + colDesc + colQty + colPrice, headerTextY, { width: colAmt - 8, align: "right" });

      tableY += rowHeight;

      // Data rows
      for (let i = 0; i < invoice.lineItems.length; i++) {
        const li = invoice.lineItems[i];
        if (!li) continue;

        // Alternating background
        if (i % 2 === 1) {
          doc.rect(leftX, tableY, pageWidth, rowHeight).fill(ALT_ROW);
        }

        const textY = tableY + 7;
        doc.font("Helvetica").fontSize(9).fillColor(BLACK);
        doc.text(li.description, leftX + 8, textY, { width: colDesc - 8 });
        doc.text(String(li.quantity), leftX + colDesc, textY, { width: colQty, align: "center" });
        doc.text(fmt(li.unitPrice, invoice.currency), leftX + colDesc + colQty, textY, { width: colPrice, align: "right" });
        doc.text(fmt(li.amount, invoice.currency), leftX + colDesc + colQty + colPrice, textY, { width: colAmt - 8, align: "right" });

        tableY += rowHeight;
      }

      // Bottom border
      doc.moveTo(leftX, tableY).lineTo(rightX, tableY)
        .strokeColor(LIGHT_GREY).lineWidth(0.5).stroke();

      // -----------------------------------------------------------------------
      // Totals
      // -----------------------------------------------------------------------

      let totalsY = tableY + 16;
      const totalsX = leftX + colDesc + colQty;
      const totalsLabelW = colPrice;
      const totalsValueW = colAmt - 8;

      // Subtotal
      doc.font("Helvetica").fontSize(9).fillColor(GREY)
        .text("Subtotal", totalsX, totalsY, { width: totalsLabelW, align: "right" });
      doc.font("Helvetica").fontSize(9).fillColor(BLACK)
        .text(fmt(invoice.subtotal, invoice.currency), totalsX + totalsLabelW, totalsY, { width: totalsValueW, align: "right" });
      totalsY += 16;

      // Tax line
      if (invoice.taxAmount > 0 && invoice.taxLabel) {
        const taxPct = invoice.taxRate != null ? ` (${Math.round(invoice.taxRate * 100)}%)` : "";
        const taxLineLabel = invoice.taxInclusive
          ? `Includes ${invoice.taxLabel} of`
          : `${invoice.taxLabel}${taxPct}`;
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(taxLineLabel, totalsX, totalsY, { width: totalsLabelW, align: "right" });
        doc.font("Helvetica").fontSize(9).fillColor(BLACK)
          .text(fmt(invoice.taxAmount, invoice.currency), totalsX + totalsLabelW, totalsY, { width: totalsValueW, align: "right" });
        totalsY += 16;
      }

      // Total line with rule above
      doc.moveTo(totalsX, totalsY).lineTo(rightX, totalsY)
        .strokeColor(LIGHT_GREY).lineWidth(0.5).stroke();
      totalsY += 8;

      doc.font("Helvetica-Bold").fontSize(11).fillColor(BLACK)
        .text("Total", totalsX, totalsY, { width: totalsLabelW, align: "right" });
      doc.font("Helvetica-Bold").fontSize(11).fillColor(BLACK)
        .text(fmt(invoice.total, invoice.currency), totalsX + totalsLabelW, totalsY, { width: totalsValueW, align: "right" });
      totalsY += 20;

      // Amount paid / amount due (if partially paid)
      if (invoice.amountPaid > 0) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text("Amount Paid", totalsX, totalsY, { width: totalsLabelW, align: "right" });
        doc.font("Helvetica").fontSize(9).fillColor(BLACK)
          .text(fmt(invoice.amountPaid, invoice.currency), totalsX + totalsLabelW, totalsY, { width: totalsValueW, align: "right" });
        totalsY += 16;

        doc.font("Helvetica-Bold").fontSize(11).fillColor("#DC2626")
          .text("Amount Due", totalsX, totalsY, { width: totalsLabelW, align: "right" });
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#DC2626")
          .text(fmt(invoice.amountDue, invoice.currency), totalsX + totalsLabelW, totalsY, { width: totalsValueW, align: "right" });
        totalsY += 20;
      }

      // -----------------------------------------------------------------------
      // Notes
      // -----------------------------------------------------------------------

      if (invoice.notes) {
        totalsY += 8;
        doc.moveTo(leftX, totalsY).lineTo(rightX, totalsY)
          .strokeColor(LIGHT_GREY).lineWidth(0.5).stroke();
        totalsY += 12;

        doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY)
          .text("NOTES", leftX, totalsY, { width: pageWidth });
        totalsY += 14;
        doc.font("Helvetica").fontSize(9).fillColor(BLACK)
          .text(invoice.notes, leftX, totalsY, { width: pageWidth });
        totalsY = doc.y;
      }

      // -----------------------------------------------------------------------
      // Footer text
      // -----------------------------------------------------------------------

      if (invoice.footer) {
        totalsY += 16;
        doc.font("Helvetica").fontSize(9).fillColor(GREY)
          .text(invoice.footer, leftX, totalsY, { width: pageWidth });
        totalsY = doc.y;
      }

      // -----------------------------------------------------------------------
      // Bottom branding
      // -----------------------------------------------------------------------

      const bottomY = doc.page.height - doc.page.margins.bottom - 14;
      doc.font("Helvetica").fontSize(8).fillColor("#BBBBBB")
        .text("Generated by Kounta — kounta.ai", leftX, bottomY, { width: pageWidth, align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
