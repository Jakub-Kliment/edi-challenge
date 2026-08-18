import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "On-Chain Completion Badges",
  description:
    "Create an ERC-721 completion badge and send it to any wallet on Polygon. No account, no wallet connection, no gas.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
