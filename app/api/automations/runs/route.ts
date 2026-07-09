import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/lib/automation/store.server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limitParam = new URL(req.url).searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 200, 1), 500);
  const runs = await listRuns(limit);
  return NextResponse.json({ runs });
}
