import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { signInWithPassword } from "@/lib/auth/session";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions } from "@/lib/auth/cookies";
import { db, supabaseConfigured } from "@/lib/db/supabase";

const Login = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) }).strict();

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return NextResponse.json({ error: "Requests must come from the Tutor Compass app." }, { status: 403 });
  }
  if (!supabaseConfigured()) return NextResponse.json({ error: "The server is not configured yet. See README.md." }, { status: 503 });
  const parsed = Login.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  const session = await signInWithPassword(parsed.data.email, parsed.data.password);
  // The same message for a wrong email or a wrong password, so accounts cannot be guessed.
  if (!session) return NextResponse.json({ error: "That email and password do not match." }, { status: 401 });
  const { data: profile } = await db().from("app_users").select("role").eq("id", session.user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "This account has not been given access to Tutor Compass." }, { status: 403 });
  const res = NextResponse.json({ ok: true, role: profile.role });
  res.cookies.set(ACCESS_COOKIE, session.access_token, cookieOptions(session.expires_in));
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(REFRESH_MAX_AGE));
  return res;
}
