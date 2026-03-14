// ---------------------------------------------------------------------------
// Urgent alert email template
//
// Sent immediately for genuinely urgent situations, max 2/week.
// Types: large_transaction, failed_connection, low_cash, plan_limit
// ---------------------------------------------------------------------------

import { emailLayout, formatAmountShort } from "./layout.js";
import type { UrgentAlertType, UrgentAlertData } from "../types.js";

export const generateUrgentAlert = (type: UrgentAlertType, data: UrgentAlertData & { actionToken?: string }): string => {
  const { userName, baseUrl } = data;
  let content = "";

  switch (type) {
    case "large_transaction": {
      const amount = formatAmountShort(data.transactionAmount ?? 0, data.currency);
      content = `
        <h1 style="font-size:18px;font-weight:600;color:#0A0A0A;margin:0 0 16px;">Unusual transaction detected</h1>
        <div style="padding:16px;border:1px solid #E5E5E5;border-radius:8px;margin-bottom:24px;">
          <div style="font-size:20px;font-weight:600;color:#0A0A0A;margin-bottom:4px;">${amount}</div>
          <div style="font-size:13px;color:#666666;">${escapeHtml(data.transactionDescription ?? "Unknown")} &mdash; ${data.transactionDate ?? ""}</div>
        </div>
        <p style="color:#666666;margin-bottom:24px;">This is significantly larger than your typical transactions. Is this expected?</p>
        <a href="${baseUrl}/bank-feeds" style="display:inline-block;padding:10px 24px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Review in Kounta</a>`;
      break;
    }
    case "failed_connection": {
      content = `
        <h1 style="font-size:18px;font-weight:600;color:#DC2626;margin:0 0 16px;">Bank connection stopped syncing</h1>
        <p style="color:#666666;margin-bottom:24px;">
          Your <strong>${escapeHtml(data.bankName ?? "bank")}</strong> connection hasn't synced in ${data.daysSinceSync ?? 2} days.
          This means new transactions aren't being pulled into Kounta.
        </p>
        <a href="${baseUrl}/bank-feeds?reconnect=true" style="display:inline-block;padding:10px 24px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Reconnect now</a>`;
      break;
    }
    case "low_cash": {
      const cash = formatAmountShort(data.cashBalance ?? 0, data.currency);
      const burn = formatAmountShort(data.burnRate ?? 0, data.currency);
      content = `
        <h1 style="font-size:18px;font-weight:600;color:#D97706;margin:0 0 16px;">Low cash alert</h1>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <tr>
            <td style="padding:8px 0;font-size:14px;color:#666666;">Cash Balance</td>
            <td style="padding:8px 0;font-size:14px;font-weight:600;color:#D97706;text-align:right;">${cash}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:14px;color:#666666;">Monthly Burn</td>
            <td style="padding:8px 0;font-size:14px;font-weight:600;color:#0A0A0A;text-align:right;">${burn}</td>
          </tr>
          <tr style="border-top:1px solid #E5E5E5;">
            <td style="padding:8px 0;font-size:14px;color:#666666;">Runway</td>
            <td style="padding:8px 0;font-size:14px;font-weight:600;color:#D97706;text-align:right;">${(data.monthsRunway ?? 0).toFixed(1)} months</td>
          </tr>
        </table>
        <a href="${baseUrl}/" style="display:inline-block;padding:10px 24px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">View details in Kounta</a>`;
      break;
    }
    case "plan_limit": {
      content = `
        <h1 style="font-size:18px;font-weight:600;color:#D97706;margin:0 0 16px;">Approaching plan limit</h1>
        <p style="color:#666666;margin-bottom:16px;">
          You've used <strong>${data.usedCount?.toLocaleString()}</strong> of <strong>${data.limitCount?.toLocaleString()}</strong> free transactions this month.
        </p>
        <div style="width:100%;height:8px;border-radius:4px;background-color:#E5E5E5;overflow:hidden;margin-bottom:24px;">
          <div style="width:${Math.min(((data.usedCount ?? 0) / (data.limitCount ?? 1)) * 100, 100)}%;height:100%;border-radius:4px;background-color:#D97706;"></div>
        </div>
        <a href="${baseUrl}/settings?tab=billing" style="display:inline-block;padding:10px 24px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Upgrade plan</a>`;
      break;
    }
  }

  const greeting = `<p style="font-size:15px;margin-bottom:24px;">Hey ${escapeHtml(userName)},</p>`;
  const signoff = `<hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;"><p style="color:#666666;">— Kounta</p>`;
  const unsubscribeUrl = `${baseUrl}/api/email-action?action=unsubscribe&type=urgent_alerts&token=`;

  return emailLayout(greeting + content + signoff, unsubscribeUrl);
};

const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
