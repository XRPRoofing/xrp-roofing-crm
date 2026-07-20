import { notFound } from "next/navigation";
import PdfSigningClient from "./PdfSigningClient";
import type { SigningPageData } from "@/lib/pdf-signer-types";

export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SignPdfPage({ params }: PageProps) {
  const { token } = await params;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

  try {
    const res = await fetch(`${appUrl}/api/pdf-sign/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
          <div className="max-w-md rounded-xl bg-white p-8 shadow">
            <h1 className="mb-2 text-xl font-bold text-slate-900">Link not available</h1>
            <p className="text-slate-600">{body.error || "This signing link is invalid, expired, or no longer available."}</p>
          </div>
        </div>
      );
    }

    const data = (await res.json()) as SigningPageData;
    return <PdfSigningClient token={token} signingData={data} />;
  } catch {
    notFound();
  }
}
