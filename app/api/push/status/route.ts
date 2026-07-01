import { NextResponse } from "next/server";
import { checkPushStatus } from "@/lib/push-notifications";

export async function GET() {
  const status = await checkPushStatus();
  return NextResponse.json(status);
}
