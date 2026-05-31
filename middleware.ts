import { NextResponse } from "next/server";

export async function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/crm/:path*", "/login", "/signup", "/forgot-password", "/reset-password"],
};
