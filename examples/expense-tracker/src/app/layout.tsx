import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Tracker — Kounta Example",
  description: "Expense tracker with CSV import and reconciliation powered by Kounta",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.tailwindcss.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400;500;600;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <div className="min-h-screen">
          <header
            className="border-b px-6 py-4 flex items-center justify-between"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                style={{
                  background: "linear-gradient(135deg, #0d9488, #5eead4)",
                  color: "#0a0f1a",
                }}
              >
                L
              </div>
              <span className="text-lg font-bold text-slate-50">
                Expense Tracker
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: "rgba(13,148,136,0.1)",
                  color: "#5eead4",
                  border: "1px solid rgba(13,148,136,0.2)",
                }}
              >
                Kounta Example
              </span>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
