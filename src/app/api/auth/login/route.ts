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
  const result = await signInWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    // The same message for a wrong email or a wrong password, so accounts cannot be guessed.
    const messages = {
      wrong_details: "That email and password do not match.",
      not_confirmed: "This account has not been confirmed yet. In Supabase, delete the user and add it again with Auto Confirm User ticked.",
      server_setup: "Sign-in is not working on the server. Check SUPABASE_URL and SUPABASE_SECRET_KEY in the hosting settings.",
    };
    return NextResponse.json({ error: messages[result.reason] }, { status: result.reason === "server_setup" ? 503 : 401 });
  }
  const session = result.session;
  const { data: profile, error: profileError } = await db().from("app_users").select("role").eq("id", session.user.id).maybeSingle();
  if (profileError) {
    console.warn("[auth] could not read app_users", profileError.code ?? "unknown");
    return NextResponse.json({ error: "Sign-in is not working on the server. Check SUPABASE_URL and SUPABASE_SECRET_KEY in the hosting settings, and that the setup SQL has been run." }, { status: 503 });
  }
  if (!profile) return NextResponse.json({ error: "This account has not been given access to Tutor Compass. Run the role query from the setup guide in the Supabase SQL Editor." }, { status: 403 });
  const res = NextResponse.json({ ok: true, role: profile.role });
  res.cookies.set(ACCESS_COOKIE, session.access_token, cookieOptions(session.expires_in));
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(REFRESH_MAX_AGE));
  return res;
}
