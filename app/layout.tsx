import type { Metadata, Viewport } from "next";
import PwaRegistrar from "@/components/PwaRegistrar";
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
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "XRP CRM",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900 antialiased">
        <PwaRegistrar />
        {children}
      </body>
    </html>
  );
}
