import { NextRequest, NextResponse } from "next/server";
import { getTwilioConfig } from "@/lib/twilio/config";

// Twilio media URLs are private — fetching them from the browser returns 401.
// This endpoint proxies a Twilio media URL server-side (with account auth) and
// streams the bytes back so the CRM can display images/video that were not
// re-hosted to public storage. Only Twilio's own media host is allowed.
const ALLOWED_HOSTS = new Set(["api.twilio.com", "media.twiliocdn.com", "mcs.us1.twilio.com"]);

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url") || "";
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.host)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  }

  const config = getTwilioConfig();
  const authHeader = "Basic " + Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  const upstream = await fetch(parsed.toString(), { headers: { Authorization: authHeader } });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Media fetch failed" }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
