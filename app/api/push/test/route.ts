import { NextResponse } from "next/server";
import { sendIncomingCallPushNotification } from "@/lib/push-notifications";

export async function POST() {
  const result = await sendIncomingCallPushNotification("+16025551234");
  return NextResponse.json(result);
}

export async function GET() {
  const result = await sendIncomingCallPushNotification("+16025551234");
  return NextResponse.json(result);
}
