// ---------------------------------------------------------------------------
// Monthly close prompt email template
//
// Sent on the 1st of each month at 9am in user's timezone.
// Shows monthly summary and one-click close button.
// ---------------------------------------------------------------------------

import { emailLayout, formatAmountShort } from "./layout.js";
import type { MonthlyCloseData } from "../types.js";

export const generateMonthlyClose = (data: MonthlyCloseData & { closeToken: string; classifyToken?: string }): string => {
  const { userName, month, year, revenue, expenses, netIncome, cashBalance, pendingClassificationsCount, currency, baseUrl, closeToken, classifyToken } = data;

  const greeting = `<p style="font-size:15px;margin-bottom:24px;">Hey ${escapeHtml(userName)},</p>
    <p style="color:#666666;margin-bottom:24px;">${month} is done. Here's how it went:</p>`;

  const stats = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#666666;">Revenue</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(revenue, currency)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#666666;">Expenses</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(expenses, currency)}</td>
      </tr>
      <tr style="border-top:1px solid #E5E5E5;">
        <td style="padding:8px 0;font-size:14px;color:#666666;">Net Income</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:${netIncome >= 0 ? "#16A34A" : "#DC2626"};text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(netIncome, currency)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#666666;">Cash Balance</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(cashBalance, currency)}</td>
      </tr>
    </table>`;

  let pendingWarning = "";
  if (pendingClassificationsCount > 0 && classifyToken) {
    pendingWarning = `
      <div style="padding:16px;background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;margin-bottom:24px;">
        <p style="font-size:13px;color:#92400E;margin:0;">
          ${pendingClassificationsCount} transaction${pendingClassificationsCount === 1 ? "" : "s"} still need${pendingClassificationsCount === 1 ? "s" : ""} classification before closing.
          <a href="${baseUrl}/bank-feeds" style="color:#92400E;font-weight:600;text-decoration:underline;">Classify now</a>
        </p>
      </div>`;
  }

  const closeUrl = `${baseUrl}/api/email-action?action=close&month=${month}&year=${year}&token=${closeToken}`;
  const closeButton = `
    <div style="text-align:center;margin:24px 0;">
      <a href="${closeUrl}" style="display:inline-block;padding:12px 32px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Close ${month}</a>
    </div>`;

  const signoff = `
    <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
    <p style="color:#666666;">— Kounta</p>`;

  const unsubscribeUrl = `${baseUrl}/api/email-action?action=unsubscribe&type=monthly_close&token=`;
  return emailLayout(greeting + stats + pendingWarning + closeButton + signoff, unsubscribeUrl);
};

const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
