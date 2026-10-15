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
