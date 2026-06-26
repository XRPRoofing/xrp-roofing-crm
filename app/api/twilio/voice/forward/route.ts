import { NextRequest, NextResponse } from "next/server";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function normalizeForwardNumber(value?: string | null) {
  const trimmed = value?.trim() || "";
  if (!trimmed) return "";

  const normalized = trimmed.startsWith("+") ? "+" + trimmed.slice(1).replace(/\D/g, "") : trimmed.replace(/\D/g, "");
  return normalized.length >= 7 ? normalized : "";
}

function buildForwardTwiml(to?: string | null, recordingCallbackUrl?: string) {
  const forwardTo = normalizeForwardNumber(to);

  if (!forwardTo) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>No valid forwarding number was provided.</Say></Response>';
  }

  const recordAttrs = recordingCallbackUrl
    ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(recordingCallbackUrl)}" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"`
    : ' record="record-from-answer-dual"';

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial${recordAttrs}><Number>${escapeXml(forwardTo)}</Number></Dial></Response>`;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData().catch(() => new FormData());
    const to = formData.get("To")?.toString() || req.nextUrl.searchParams.get("To");
    const callbackUrl = new URL("/api/twilio/webhooks/call-status", req.nextUrl.origin).toString();

    return new NextResponse(buildForwardTwiml(to, callbackUrl), { headers: { "Content-Type": "text/xml" } });
  } catch {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Forwarding could not be completed.</Say></Response>', { headers: { "Content-Type": "text/xml" } });
  }
}

export async function GET(req: NextRequest) {
  const to = req.nextUrl.searchParams.get("To");
  const callbackUrl = new URL("/api/twilio/webhooks/call-status", req.nextUrl.origin).toString();

  return new NextResponse(buildForwardTwiml(to, callbackUrl), { headers: { "Content-Type": "text/xml" } });
}
