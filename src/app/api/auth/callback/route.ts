import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, FLOW_COOKIE, RECOVERY_COOKIE, RECOVERY_MAX_AGE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions, decodeFlow } from "@/lib/auth/cookies";
import { db, flowClient, supabaseConfigured } from "@/lib/db/supabase";

// Where people land after a social sign-in, a "confirm your email" link or a password
// reset link. Supabase adds a one-time code; we swap it for a session on the server.
// A session only becomes a Tutor Compass sign-in if the owner has given that person access.

export async function GET(req: NextRequest) {
  const flow = decodeFlow(req.cookies.get(FLOW_COOKIE)?.value);
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.delete(FLOW_COOKIE);
    return res;
  };
  if (!supabaseConfigured()) return go("/login?error=setup");
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return go("/login?error=link");
  // The link was opened in a different browser from the one that asked for it.
  if (!flow) return go("/login?notice=other_browser");

  const { client } = flowClient(flow.v);
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    console.warn("[auth] could not finish sign-in link", error?.code ?? "no_session");
    return go("/login?error=link");
  }
  const session = data.session;

  if (flow.kind === "recovery") {
    const res = go("/reset-password");
    res.cookies.set(RECOVERY_COOKIE, session.access_token, cookieOptions(RECOVERY_MAX_AGE));
    return res;
  }

  const { data: profile } = await db().from("app_users").select("role").eq("id", session.user.id).maybeSingle();
  if (!profile) return go(`/login?notice=${flow.kind === "signup" ? "confirmed" : "pending"}`);
  const res = go(flow.next);
  res.cookies.set(ACCESS_COOKIE, session.access_token, cookieOptions(session.expires_in));
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(REFRESH_MAX_AGE));
  return res;
}
