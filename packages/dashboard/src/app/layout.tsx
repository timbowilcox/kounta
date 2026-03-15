import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Kounta: Accounting for Builders",
    template: "%s | Kounta",
  },
  description: "Programmable double-entry ledger and reporting engine",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <link rel="icon" type="image/png" href="/favicon.png" media="(prefers-color-scheme: light)" />
        <link rel="icon" type="image/png" href="/favicon_light.png" media="(prefers-color-scheme: dark)" />
      </head>
      <body style={{ WebkitFontSmoothing: "antialiased" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
