import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BASE = "https://api.companycam.com/v2";

function getToken(): string | null {
  return process.env.COMPANYCAM_API_TOKEN || null;
}

async function ccFetch(path: string, init?: RequestInit) {
  const token = getToken();
  if (!token) return NextResponse.json({ error: "CompanyCam not configured" }, { status: 503 });
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json({ error: text || res.statusText }, { status: res.status });
  }
  const data = await res.json();
  return NextResponse.json(data);
}

/**
 * GET /api/companycam?action=projects          — list all projects
 * GET /api/companycam?action=photos&projectId=X — list photos for a project
 * GET /api/companycam?action=search&q=address   — search projects by address
 * GET /api/companycam?action=status             — check connection status
 */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "status";

  if (action === "status") {
    const token = getToken();
    if (!token) return NextResponse.json({ connected: false });
    try {
      const res = await fetch(`${BASE}/projects?per_page=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return NextResponse.json({ connected: res.ok });
    } catch {
      return NextResponse.json({ connected: false });
    }
  }

  if (action === "projects") {
    const page = req.nextUrl.searchParams.get("page") || "1";
    const perPage = req.nextUrl.searchParams.get("per_page") || "100";
    return ccFetch(`/projects?page=${page}&per_page=${perPage}`);
  }

  if (action === "photos") {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    const page = req.nextUrl.searchParams.get("page") || "1";
    const perPage = req.nextUrl.searchParams.get("per_page") || "50";
    return ccFetch(`/projects/${projectId}/photos?page=${page}&per_page=${perPage}`);
  }

  if (action === "search") {
    const q = req.nextUrl.searchParams.get("q") || "";
    if (!q) return NextResponse.json([]);
    return ccFetch(`/projects?query=${encodeURIComponent(q)}&per_page=20`);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
