import type { Metadata } from "next";
import { Orbitron, Space_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted by Next at build time (next/font downloads once during build
// and serves from this domain) — no client-side request to Google, so the
// deployed app stays self-contained.
const orbitron = Orbitron({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-display" });
const spaceMono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-mono-vw" });

export const metadata: Metadata = {
  title: "On-Chain Completion Badges",
  description:
    "Create an ERC-721 completion badge and send it to any wallet on Polygon. No account, no wallet connection, no gas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${orbitron.variable} ${spaceMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
