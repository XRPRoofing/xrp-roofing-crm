import { NextRequest, NextResponse } from "next/server";
import { getTwilioConfig } from "@/lib/twilio/config";

export const runtime = "nodejs";

const RECORDING_SID_PATTERN = /^RE[0-9a-fA-F]{32}$/;

function resolveRecordingUrl(req: NextRequest, accountSid: string): string | null {
  const sid = req.nextUrl.searchParams.get("sid");
  if (sid && RECORDING_SID_PATTERN.test(sid)) {
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`;
  }

  const rawUrl = req.nextUrl.searchParams.get("url");
  if (rawUrl) {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "api.twilio.com") return null;
    if (!parsed.pathname.includes("/Recordings/")) return null;
    return parsed.toString();
  }

  return null;
}

export async function GET(req: NextRequest) {
  const config = getTwilioConfig();
  if (!config.accountSid || !config.authToken) {
    return NextResponse.json({ error: "Twilio is not configured" }, { status: 503 });
  }

  const targetUrl = resolveRecordingUrl(req, config.accountSid);
  if (!targetUrl) {
    return NextResponse.json({ error: "Invalid recording reference" }, { status: 400 });
  }

  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const range = req.headers.get("range");

  const twilioResponse = await fetch(targetUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      ...(range ? { Range: range } : {}),
    },
  });

  if (!twilioResponse.ok && twilioResponse.status !== 206) {
    return NextResponse.json(
      { error: "Recording unavailable" },
      { status: twilioResponse.status === 404 ? 404 : 502 },
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", twilioResponse.headers.get("content-type") || "audio/mpeg");
  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    const value = twilioResponse.headers.get(header);
    if (value) headers.set(header, value);
  }
  headers.set("Cache-Control", "private, max-age=3600");

  return new NextResponse(twilioResponse.body, {
    status: twilioResponse.status,
    headers,
  });
}
