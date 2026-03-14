// ---------------------------------------------------------------------------
// Onboarding email templates
//
// Day 1: Welcome + connect bank CTA
// Day 3: Classify prompt (if bank connected but items unclassified)
// Day 7: First financial snapshot
// ---------------------------------------------------------------------------

import { emailLayout, formatAmountShort } from "./layout.js";
import type { OnboardingSummary } from "../types.js";

/** Day 1 — Welcome email with connect bank CTA. */
export const generateWelcomeEmail = (name: string, baseUrl: string = "https://kounta.ai"): string => {
  const content = `
    <h1 style="font-size:20px;font-weight:600;color:#0A0A0A;margin:0 0 16px;">Welcome to Kounta</h1>
    <p style="font-size:15px;margin-bottom:24px;">Hey ${escapeHtml(name)},</p>
    <p style="color:#666666;margin-bottom:24px;">
      Kounta handles your books so you don't have to think about them.
      Connect your bank account and we'll start classifying transactions automatically.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${baseUrl}/bank-feeds" style="display:inline-block;padding:12px 32px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Connect your bank account</a>
    </div>
    <p style="color:#999999;font-size:13px;">
      Most founders are set up in under 3 minutes. Kounta auto-classifies the majority of transactions
      and only asks for your input on the few it can't figure out.
    </p>
    <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
    <p style="color:#666666;">Welcome aboard.<br>— Kounta</p>`;

  return emailLayout(content);
};

/** Day 3 — Prompt to classify first transactions. */
export const generateClassifyPrompt = (name: string, count: number, baseUrl: string = "https://kounta.ai"): string => {
  const content = `
    <h1 style="font-size:18px;font-weight:600;color:#0A0A0A;margin:0 0 16px;">Your first transactions are ready</h1>
    <p style="font-size:15px;margin-bottom:24px;">Hey ${escapeHtml(name)},</p>
    <p style="color:#666666;margin-bottom:24px;">
      We pulled in your recent transactions and auto-classified most of them.
      <strong>${count}</strong> transaction${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your input &mdash; it takes about 2 minutes.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${baseUrl}/bank-feeds" style="display:inline-block;padding:12px 32px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Classify ${count} transaction${count === 1 ? "" : "s"}</a>
    </div>
    <p style="color:#999999;font-size:13px;">
      After you classify a merchant once or twice, Kounta remembers and does it automatically next time.
    </p>
    <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
    <p style="color:#666666;">— Kounta</p>`;

  return emailLayout(content);
};

/** Day 7 — First financial snapshot. */
export const generateFirstSnapshot = (name: string, summary: OnboardingSummary, baseUrl: string = "https://kounta.ai"): string => {
  const { revenue, expenses, netIncome, cashBalance, currency } = summary;

  const content = `
    <h1 style="font-size:18px;font-weight:600;color:#0A0A0A;margin:0 0 16px;">Your first financial snapshot</h1>
    <p style="font-size:15px;margin-bottom:24px;">Hey ${escapeHtml(name)},</p>
    <p style="color:#666666;margin-bottom:24px;">Here's where your business stands:</p>
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
    </table>
    <p style="color:#666666;margin-bottom:24px;">
      Going forward, you'll get a weekly digest every Monday with your numbers and any transactions that need classifying.
      Most weeks, it takes less than a minute.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${baseUrl}/" style="display:inline-block;padding:10px 24px;background-color:#0066FF;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Open Kounta</a>
    </div>
    <hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">
    <p style="color:#666666;">— Kounta</p>`;

  return emailLayout(content);
};

const escapeHtml = (str: string): string =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
