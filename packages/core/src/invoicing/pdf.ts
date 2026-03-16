// ---------------------------------------------------------------------------
// Invoice PDF generation — clean, professional invoice documents.
//
// Uses pdf-lib (pure JavaScript, zero native dependencies) to generate
// professional invoices matching the style of Stripe/Xero invoices:
// black text, subtle grey lines, no colour.
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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
// Colour helpers (pdf-lib uses 0–1 floats)
// ---------------------------------------------------------------------------

const BLACK = rgb(10 / 255, 10 / 255, 10 / 255);
const GREY = rgb(102 / 255, 102 / 255, 102 / 255);
const LIGHT_GREY = rgb(229 / 255, 229 / 255, 229 / 255);
const ALT_ROW_BG = rgb(249 / 255, 250 / 255, 251 / 255);
const HEADER_BG = rgb(243 / 255, 244 / 255, 246 / 255);
const RED = rgb(220 / 255, 38 / 255, 38 / 255);
const WATERMARK_GREY = rgb(187 / 255, 187 / 255, 187 / 255);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

export const generateInvoicePDF = async (
  invoice: Invoice,
  config: InvoicePDFConfig,
): Promise<Buffer> => {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.invoiceNumber}`);
  doc.setAuthor(config.businessName);
  doc.setSubject(`Invoice for ${invoice.customerName}`);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  // A4 dimensions in points
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  const page = doc.addPage([pageWidth, pageHeight]);

  // pdf-lib uses bottom-left origin; we track cursor from top
  let y = pageHeight - margin;

  // Helper: draw text and return new y position
  const drawText = (
    text: string,
    x: number,
    yPos: number,
    options: {
      size?: number;
      font?: typeof font;
      color?: ReturnType<typeof rgb>;
      maxWidth?: number;
      align?: "left" | "right";
    } = {},
  ): number => {
    const f = options.font ?? font;
    const size = options.size ?? 9;
    const color = options.color ?? BLACK;

    if (options.align === "right" && options.maxWidth) {
      const textWidth = f.widthOfTextAtSize(text, size);
      const xRight = x + options.maxWidth - textWidth;
      page.drawText(text, { x: xRight, y: yPos, size, font: f, color });
    } else {
      page.drawText(text, { x, y: yPos, size, font: f, color });
    }
    return yPos - size - 3;
  };

  // -----------------------------------------------------------------------
  // Header: Business info (left) + Invoice heading (right)
  // -----------------------------------------------------------------------

  // Business name (left)
  y = drawText(config.businessName, margin, y, { size: 16, font: boldFont });

  // Tax ID
  if (config.taxId && config.taxIdLabel) {
    y = drawText(`${config.taxIdLabel}: ${config.taxId}`, margin, y, { size: 9, color: GREY });
  }

  // Business address, email, phone
  if (config.businessAddress) {
    y = drawText(config.businessAddress, margin, y, { size: 9, color: GREY });
  }
  if (config.businessEmail) {
    y = drawText(config.businessEmail, margin, y, { size: 9, color: GREY });
  }
  if (config.businessPhone) {
    y = drawText(config.businessPhone, margin, y, { size: 9, color: GREY });
  }

  // Right side: INVOICE heading
  const rightColX = margin + contentWidth / 2;
  const rightColWidth = contentWidth / 2;
  let rightY = pageHeight - margin;

  drawText("INVOICE", rightColX, rightY, {
    size: 24, font: boldFont, maxWidth: rightColWidth, align: "right",
  });
  rightY -= 32;

  // Invoice number
  drawText("Invoice No.", rightColX, rightY, {
    size: 9, color: GREY, maxWidth: rightColWidth - 80, align: "right",
  });
  drawText(invoice.invoiceNumber, rightColX + rightColWidth - 78, rightY, {
    size: 9, font: boldFont, maxWidth: 78, align: "right",
  });
  rightY -= 14;

  // Issue date
  drawText("Issue Date", rightColX, rightY, {
    size: 9, color: GREY, maxWidth: rightColWidth - 80, align: "right",
  });
  drawText(fmtDate(invoice.issueDate), rightColX + rightColWidth - 78, rightY, {
    size: 9, maxWidth: 78, align: "right",
  });
  rightY -= 14;

  // Due date
  drawText("Due Date", rightColX, rightY, {
    size: 9, color: GREY, maxWidth: rightColWidth - 80, align: "right",
  });
  drawText(fmtDate(invoice.dueDate), rightColX + rightColWidth - 78, rightY, {
    size: 9, maxWidth: 78, align: "right",
  });
  rightY -= 14;

  // Status
  drawText("Status", rightColX, rightY, {
    size: 9, color: GREY, maxWidth: rightColWidth - 80, align: "right",
  });
  drawText(statusLabel(invoice.status), rightColX + rightColWidth - 78, rightY, {
    size: 9, font: boldFont, maxWidth: 78, align: "right",
  });

  // -----------------------------------------------------------------------
  // Divider
  // -----------------------------------------------------------------------

  const afterHeader = Math.min(y, rightY) - 12;
  page.drawLine({
    start: { x: margin, y: afterHeader },
    end: { x: pageWidth - margin, y: afterHeader },
    thickness: 1,
    color: LIGHT_GREY,
  });

  // -----------------------------------------------------------------------
  // Bill To
  // -----------------------------------------------------------------------

  let billY = afterHeader - 16;
  billY = drawText("BILL TO", margin, billY, { size: 9, color: GREY });
  billY = drawText(invoice.customerName, margin, billY, { size: 10, font: boldFont });

  if (invoice.customerEmail) {
    billY = drawText(invoice.customerEmail, margin, billY, { size: 9, color: GREY });
  }
  if (invoice.customerAddress) {
    billY = drawText(invoice.customerAddress, margin, billY, { size: 9, color: GREY });
  }

  // -----------------------------------------------------------------------
  // Line Items Table
  // -----------------------------------------------------------------------

  let tableY = billY - 16;

  // Column widths
  const colDesc = contentWidth * 0.48;
  const colQty = contentWidth * 0.12;
  const colPrice = contentWidth * 0.20;
  const colAmt = contentWidth * 0.20;
  const rowHeight = 24;

  // Header row background
  page.drawRectangle({
    x: margin,
    y: tableY - rowHeight,
    width: contentWidth,
    height: rowHeight,
    color: HEADER_BG,
  });

  const headerTextY = tableY - 15;
  drawText("DESCRIPTION", margin + 8, headerTextY, { size: 8, font: boldFont, color: GREY });
  drawText("QTY", margin + colDesc, headerTextY, { size: 8, font: boldFont, color: GREY });
  drawText("UNIT PRICE", margin + colDesc + colQty, headerTextY, {
    size: 8, font: boldFont, color: GREY, maxWidth: colPrice, align: "right",
  });
  drawText("AMOUNT", margin + colDesc + colQty + colPrice, headerTextY, {
    size: 8, font: boldFont, color: GREY, maxWidth: colAmt - 8, align: "right",
  });

  tableY -= rowHeight;

  // Data rows
  for (let i = 0; i < invoice.lineItems.length; i++) {
    const li = invoice.lineItems[i];
    if (!li) continue;

    // Alternating background
    if (i % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: tableY - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: ALT_ROW_BG,
      });
    }

    const textY = tableY - 15;
    drawText(li.description, margin + 8, textY, { size: 9 });
    drawText(String(li.quantity), margin + colDesc, textY, { size: 9 });
    drawText(fmt(li.unitPrice, invoice.currency), margin + colDesc + colQty, textY, {
      size: 9, maxWidth: colPrice, align: "right",
    });
    drawText(fmt(li.amount, invoice.currency), margin + colDesc + colQty + colPrice, textY, {
      size: 9, maxWidth: colAmt - 8, align: "right",
    });

    tableY -= rowHeight;
  }

  // Bottom border of table
  page.drawLine({
    start: { x: margin, y: tableY },
    end: { x: pageWidth - margin, y: tableY },
    thickness: 0.5,
    color: LIGHT_GREY,
  });

  // -----------------------------------------------------------------------
  // Totals
  // -----------------------------------------------------------------------

  let totalsY = tableY - 16;
  const totalsX = margin + colDesc + colQty;
  const totalsLabelW = colPrice;
  const totalsValueW = colAmt - 8;

  // Subtotal
  drawText("Subtotal", totalsX, totalsY, {
    size: 9, color: GREY, maxWidth: totalsLabelW, align: "right",
  });
  drawText(fmt(invoice.subtotal, invoice.currency), totalsX + totalsLabelW, totalsY, {
    size: 9, maxWidth: totalsValueW, align: "right",
  });
  totalsY -= 16;

  // Tax line
  if (invoice.taxAmount > 0 && invoice.taxLabel) {
    const taxPct = invoice.taxRate != null ? ` (${Math.round(invoice.taxRate * 100)}%)` : "";
    const taxLineLabel = invoice.taxInclusive
      ? `Includes ${invoice.taxLabel} of`
      : `${invoice.taxLabel}${taxPct}`;
    drawText(taxLineLabel, totalsX, totalsY, {
      size: 9, color: GREY, maxWidth: totalsLabelW, align: "right",
    });
    drawText(fmt(invoice.taxAmount, invoice.currency), totalsX + totalsLabelW, totalsY, {
      size: 9, maxWidth: totalsValueW, align: "right",
    });
    totalsY -= 16;
  }

  // Total line with rule above
  page.drawLine({
    start: { x: totalsX, y: totalsY },
    end: { x: pageWidth - margin, y: totalsY },
    thickness: 0.5,
    color: LIGHT_GREY,
  });
  totalsY -= 16;

  drawText("Total", totalsX, totalsY, {
    size: 11, font: boldFont, maxWidth: totalsLabelW, align: "right",
  });
  drawText(fmt(invoice.total, invoice.currency), totalsX + totalsLabelW, totalsY, {
    size: 11, font: boldFont, maxWidth: totalsValueW, align: "right",
  });
  totalsY -= 20;

  // Amount paid / amount due (if partially paid)
  if (invoice.amountPaid > 0) {
    drawText("Amount Paid", totalsX, totalsY, {
      size: 9, color: GREY, maxWidth: totalsLabelW, align: "right",
    });
    drawText(fmt(invoice.amountPaid, invoice.currency), totalsX + totalsLabelW, totalsY, {
      size: 9, maxWidth: totalsValueW, align: "right",
    });
    totalsY -= 16;

    drawText("Amount Due", totalsX, totalsY, {
      size: 11, font: boldFont, color: RED, maxWidth: totalsLabelW, align: "right",
    });
    drawText(fmt(invoice.amountDue, invoice.currency), totalsX + totalsLabelW, totalsY, {
      size: 11, font: boldFont, color: RED, maxWidth: totalsValueW, align: "right",
    });
    totalsY -= 20;
  }

  // -----------------------------------------------------------------------
  // Notes
  // -----------------------------------------------------------------------

  if (invoice.notes) {
    totalsY -= 8;
    page.drawLine({
      start: { x: margin, y: totalsY },
      end: { x: pageWidth - margin, y: totalsY },
      thickness: 0.5,
      color: LIGHT_GREY,
    });
    totalsY -= 16;

    totalsY = drawText("NOTES", margin, totalsY, { size: 9, font: boldFont, color: GREY });
    drawText(invoice.notes, margin, totalsY, { size: 9 });
    // Approximate line height for notes
    const noteLines = Math.ceil(font.widthOfTextAtSize(invoice.notes, 9) / contentWidth);
    totalsY -= noteLines * 12;
  }

  // -----------------------------------------------------------------------
  // Footer text
  // -----------------------------------------------------------------------

  if (invoice.footer) {
    totalsY -= 8;
    drawText(invoice.footer, margin, totalsY, { size: 9, color: GREY });
  }

  // -----------------------------------------------------------------------
  // Bottom branding
  // -----------------------------------------------------------------------

  const brandingText = "Generated by Kounta — kounta.ai";
  const brandingWidth = font.widthOfTextAtSize(brandingText, 8);
  page.drawText(brandingText, {
    x: (pageWidth - brandingWidth) / 2,
    y: margin - 6,
    size: 8,
    font,
    color: WATERMARK_GREY,
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
};
