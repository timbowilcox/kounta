import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "Kounta — Accounting for Builders",
  description: "Programmable double-entry ledger and reporting engine",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body style={{ WebkitFontSmoothing: "antialiased" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
