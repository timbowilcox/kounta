// ---------------------------------------------------------------------------
// Weekly digest email template
//
// Sent every Monday (or user's chosen day) at 9am in their timezone.
// Shows financial summary and pending classifications with action buttons.
// ---------------------------------------------------------------------------

import { emailLayout, formatAmountShort } from "./layout.js";
import type { WeeklyDigestData, PendingClassification } from "../types.js";

const classificationButton = (
  txnId: string,
  categoryName: string,
  accountId: string,
  token: string,
  baseUrl: string,
  isPersonal: boolean = false,
): string => {
  const url = `${baseUrl}/api/email-action?action=classify&txn=${txnId}&category=${encodeURIComponent(accountId)}&token=${token}`;
  const style = isPersonal
    ? "display:inline-block;padding:6px 14px;background-color:#F5F5F5;color:#666666;text-decoration:none;border-radius:4px;font-size:12px;font-weight:500;border:1px solid #E5E5E5;margin:4px 4px 4px 0;"
    : "display:inline-block;padding:6px 14px;background-color:#F0F6FF;color:#0066FF;text-decoration:none;border-radius:4px;font-size:12px;font-weight:500;border:1px solid rgba(0,102,255,0.2);margin:4px 4px 4px 0;";
  return `<a href="${url}" style="${style}">${categoryName}</a>`;
};

const classificationItem = (item: PendingClassification & { token: string }, baseUrl: string, currency: string): string => {
  const buttons = item.suggestedCategories
    .map((cat) => classificationButton(item.id, cat.name, cat.accountId, item.token, baseUrl, false))
    .join("");
  const personalBtn = classificationButton(item.id, "Personal \u2014 exclude", "personal", item.token, baseUrl, true);

  return `
    <div style="padding:16px;border:1px solid #E5E5E5;border-radius:8px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="font-weight:600;font-size:14px;color:#0A0A0A;">${formatAmountShort(item.amount, currency)}</span>
        <span style="font-size:12px;color:#999999;">${item.date}</span>
      </div>
      <div style="font-size:13px;color:#666666;margin-bottom:12px;">${escapeHtml(item.description)}</div>
      <div>${buttons}${personalBtn}</div>
    </div>`;
};

export const generateWeeklyDigest = (data: WeeklyDigestData & { tokens: Record<string, string> }): string => {
  const { userName, revenue, expenses, net, cashBalance, pendingClassifications, currency, baseUrl, tokens, revenueRecognition } = data;

  const greeting = `<p style="font-size:15px;margin-bottom:24px;">Hey ${escapeHtml(userName)},</p>
    <p style="color:#666666;margin-bottom:24px;">Here's your week at a glance:</p>`;

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
        <td style="padding:8px 0;font-size:14px;color:#666666;">Net</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:${net >= 0 ? "#16A34A" : "#DC2626"};text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(net, currency)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#666666;">Cash</td>
        <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(cashBalance, currency)}</td>
      </tr>
    </table>`;

  let revenueSection = "";
  if (revenueRecognition && revenueRecognition.activeScheduleCount > 0) {
    revenueSection = `
      <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
      <h2 style="font-size:15px;font-weight:600;color:#0A0A0A;margin:0 0 16px;">Revenue Recognition</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#666666;">Recognised this week</td>
          <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(revenueRecognition.recognisedThisWeek, currency)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#666666;">Deferred revenue balance</td>
          <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;font-variant-numeric:tabular-nums;">${formatAmountShort(revenueRecognition.deferredBalance, currency)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#666666;">Active schedules</td>
          <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;font-variant-numeric:tabular-nums;">${revenueRecognition.activeScheduleCount}</td>
        </tr>
      </table>`;
  }

  let classificationSection = "";
  if (pendingClassifications.length > 0) {
    const items = pendingClassifications
      .map((item) => classificationItem({ ...item, token: tokens[item.id] ?? "" }, baseUrl, currency))
      .join("");

    classificationSection = `
      <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
      <h2 style="font-size:15px;font-weight:600;color:#0A0A0A;margin:0 0 16px;">${pendingClassifications.length} transaction${pendingClassifications.length === 1 ? "" : "s"} need${pendingClassifications.length === 1 ? "s" : ""} your input</h2>
      ${items}
      <div style="text-align:center;margin-top:16px;">
        <a href="${baseUrl}/bank-feeds" style="display:inline-block;padding:10px 24px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Classify all in Ledge</a>
      </div>`;
  }

  const signoff = `
    <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
    <p style="color:#666666;">Have a great week.<br>— Ledge</p>`;

  const unsubscribeUrl = `${baseUrl}/api/email-action?action=unsubscribe&type=weekly_digest&token=`;
  return emailLayout(greeting + stats + revenueSection + classificationSection + signoff, unsubscribeUrl);
};

const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
