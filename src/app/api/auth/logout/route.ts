import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth/cookies";
import { db } from "@/lib/db/supabase";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  // Revoke the session in Supabase Auth as well as clearing the cookies.
  if (token) await db().auth.admin.signOut(token).catch(() => undefined);
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
