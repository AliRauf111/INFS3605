import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, cookieOptions, tokenExpiresAt } from "@/lib/auth/cookies";
import { DEMO_EPOCH_COOKIE, demoResetEnabled, isFullPageLoad } from "@/lib/demo/mode";
import { resetDemoData } from "@/lib/demo/reset";

// Runs on the server before each page or API request. It refreshes an expiring sign-in
// session and sends signed-out visitors to the login page. Permission checks still
// happen inside every API route; this is only the front door.
//
// In demo mode, a signed-in full page load (a refresh, a typed address, signing in) first
// puts the fictional demo data back to its original state, and waits for that, so the
// page and Compass never see half-loaded or out-of-date demo records. Moving between pages
// inside the app doesn't reset anything.

// Pages anyone can open. API routes are never redirected here; each one checks access itself.
const PUBLIC_PATHS = ["/login", "/reset-password", "/support", "/privacy", "/terms", "/api/auth/login", "/api/auth/logout", "/api/health"];

async function refresh(refreshToken: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  let origin = url.trim();
  try {
    origin = new URL(origin).origin; // ignore any extra path pasted after the project address
  } catch {}
  const client = createClient(origin, key.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  return error || !data.session ? null : data.session;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);
  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  let renewed: Awaited<ReturnType<typeof refresh>> = null;
  let clear = false;
  const exp = access ? tokenExpiresAt(access) : null;
  if (refreshToken && (!access || !exp || exp - Date.now() < 60_000)) {
    renewed = await refresh(refreshToken);
    if (renewed) {
      access = renewed.access_token;
      req.cookies.set(ACCESS_COOKIE, renewed.access_token);
      req.cookies.set(REFRESH_COOKIE, renewed.refresh_token);
    } else {
      access = undefined;
      clear = true;
      req.cookies.delete(ACCESS_COOKIE);
      req.cookies.delete(REFRESH_COOKIE);
    }
  }

  let res: NextResponse;
  let demoEpoch: string | null = null;
  if (!access && !isPublic && !pathname.startsWith("/api/")) {
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    res = NextResponse.redirect(login);
  } else {
    if (access && !isPublic && !pathname.startsWith("/api/") && demoResetEnabled(process.env.DEMO_MODE) && isFullPageLoad(req.method, req.headers)) {
      const reset = await resetDemoData();
      if (reset.ok) {
        req.cookies.set(DEMO_EPOCH_COOKIE, reset.epoch);
        demoEpoch = reset.epoch;
      } else if (reset.reason !== "not_configured") {
        console.warn(`Demo reset skipped: ${reset.reason}`);
      }
    }
    res = NextResponse.next({ request: { headers: req.headers } });
  }
  if (demoEpoch) {
    // Readable by the page, so Compass knows the demo data was reset. Lasts for the browser session.
    res.cookies.set(DEMO_EPOCH_COOKIE, demoEpoch, { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  }
  if (renewed) {
    res.cookies.set(ACCESS_COOKIE, renewed.access_token, cookieOptions(renewed.expires_in));
    res.cookies.set(REFRESH_COOKIE, renewed.refresh_token, cookieOptions(REFRESH_MAX_AGE));
  }
  if (clear) {
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
