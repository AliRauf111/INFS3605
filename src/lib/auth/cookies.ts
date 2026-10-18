// Cookie names and settings shared by the proxy and the session helpers.
export const ACCESS_COOKIE = "tc_access";
export const REFRESH_COOKIE = "tc_refresh";
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // a week

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Read the expiry time from a token without trusting anything else in it. */
export function tokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// The email and social sign-in flows leave the app and come back to /api/auth/callback.
// This cookie remembers what was started (and Supabase's one-time code verifier) so the
// callback knows how to finish it. It lasts an hour, the life of an email link.
export const FLOW_COOKIE = "tc_flow";
export const FLOW_MAX_AGE = 60 * 60;
// Set only after a password-reset link is opened. It lets /reset-password change that
// one account's password, then it is cleared.
export const RECOVERY_COOKIE = "tc_recovery";
export const RECOVERY_MAX_AGE = 60 * 15;

export type FlowKind = "signin" | "signup" | "recovery";
export type Flow = { v: string; kind: FlowKind; next: string };

export function encodeFlow(flow: Flow): string {
  return Buffer.from(JSON.stringify(flow), "utf8").toString("base64url");
}

export function decodeFlow(raw: string | undefined): Flow | null {
  if (!raw) return null;
  try {
    const f = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof f?.v !== "string" || !["signin", "signup", "recovery"].includes(f.kind)) return null;
    return { v: f.v, kind: f.kind, next: safeNext(f.next) };
  } catch {
    return null;
  }
}

/** Only follow redirects to pages inside this app. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
