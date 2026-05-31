import { NextRequest, NextResponse } from "next/server";
import { buildOutboundBrowserCallTwiml } from "@/lib/twilio/server";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const to = formData.get("To")?.toString();
  const twiml = buildOutboundBrowserCallTwiml(to);

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}
