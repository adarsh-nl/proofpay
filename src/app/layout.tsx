import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProofPay — vision-verified escrow on PayPal",
  description:
    "Before/after photo verification with PayPal sandbox escrow. Funds are held by PayPal until the AI verifies the work.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
