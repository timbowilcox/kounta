// ---------------------------------------------------------------------------
// Shared email layout — Kounta branding wrapper for all emails.
// Clean, monochrome, white bg, #0A0A0A text, mobile-responsive (600px).
// ---------------------------------------------------------------------------

export const emailLayout = (content: string, unsubscribeUrl?: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kounta</title>
  <style>
    body { margin: 0; padding: 0; background-color: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 0 auto; background-color: #FFFFFF; }
    .header { padding: 32px 40px 24px; border-bottom: 1px solid #E5E5E5; }
    .logo { font-size: 18px; font-weight: 700; color: #0A0A0A; letter-spacing: -0.02em; text-decoration: none; }
    .content { padding: 32px 40px; color: #0A0A0A; font-size: 14px; line-height: 1.6; }
    .footer { padding: 24px 40px; border-top: 1px solid #E5E5E5; text-align: center; }
    .footer p { font-size: 12px; color: #999999; margin: 4px 0; }
    .footer a { color: #999999; text-decoration: underline; }
    .btn { display: inline-block; padding: 10px 20px; background-color: #0066FF; color: #FFFFFF; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600; }
    .btn-secondary { display: inline-block; padding: 8px 16px; background-color: #F5F5F5; color: #0A0A0A; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid #E5E5E5; }
    .btn-personal { display: inline-block; padding: 8px 16px; background-color: #F5F5F5; color: #666666; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500; border: 1px solid #E5E5E5; }
    .divider { border: none; border-top: 1px solid #E5E5E5; margin: 24px 0; }
    .stat-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
    .stat-label { color: #666666; }
    .stat-value { font-weight: 600; color: #0A0A0A; font-variant-numeric: tabular-nums; }
    .mono { font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, Consolas, monospace; }
    h1 { font-size: 18px; font-weight: 600; color: #0A0A0A; margin: 0 0 8px; }
    h2 { font-size: 15px; font-weight: 600; color: #0A0A0A; margin: 24px 0 12px; }
    p { margin: 0 0 12px; }
    @media only screen and (max-width: 640px) {
      .wrapper { width: 100% !important; }
      .header, .content, .footer { padding-left: 24px !important; padding-right: 24px !important; }
    }
  </style>
</head>
<body>
  <div style="background-color: #F5F5F5; padding: 32px 16px;">
    <div class="wrapper" style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; overflow: hidden; border: 1px solid #E5E5E5;">
      <div class="header" style="padding: 32px 40px 24px; border-bottom: 1px solid #E5E5E5;">
        <a href="https://kounta.ai" class="logo" style="font-size: 18px; font-weight: 700; color: #0A0A0A; letter-spacing: -0.02em; text-decoration: none;">Kounta</a>
      </div>
      <div class="content" style="padding: 32px 40px; color: #0A0A0A; font-size: 14px; line-height: 1.6;">
        ${content}
      </div>
      <div class="footer" style="padding: 24px 40px; border-top: 1px solid #E5E5E5; text-align: center;">
        <p style="font-size: 12px; color: #999999; margin: 4px 0;">Kounta &mdash; Accounting infrastructure for builders</p>
        ${unsubscribeUrl ? `<p style="font-size: 12px; color: #999999; margin: 4px 0;"><a href="${unsubscribeUrl}" style="color: #999999; text-decoration: underline;">Unsubscribe from these emails</a></p>` : ""}
      </div>
    </div>
  </div>
</body>
</html>`;

/** Format an integer amount (cents) as a currency string. */
export const formatAmount = (amount: number, currency: string = "USD"): string => {
  const abs = Math.abs(amount);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const sign = amount < 0 ? "-" : "";
  const SYMBOLS: Record<string, string> = { USD: "$", GBP: "\u00A3", EUR: "\u20AC", AUD: "A$", CAD: "C$", NZD: "NZ$", JPY: "\u00A5", CHF: "CHF ", INR: "\u20B9", SGD: "S$", HKD: "HK$", ZAR: "R" };
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${sign}${symbol}${dollars.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
};

/** Format amount without cents for cleaner display when .00 */
export const formatAmountShort = (amount: number, currency: string = "USD"): string => {
  const full = formatAmount(amount, currency);
  return full.endsWith(".00") ? full.slice(0, -3) : full;
};
