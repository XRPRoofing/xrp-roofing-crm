import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#07183f",
};

export const metadata: Metadata = {
  title: {
    default: "XRP Roofing CRM",
    template: "%s | XRP Roofing CRM",
  },
  description: "Standalone XRP Roofing CRM workspace for leads, customers, invoices, payments, proposals, conversations, and operations.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
