import "server-only";
import { cache } from "react";
import type { Session } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { authClient, db } from "@/lib/db/supabase";
import type { Role } from "@/lib/domain/types";
import { isLanguage, type Language } from "@/lib/i18n/languages";

// Sign-in uses Supabase Auth, called from the server. The tokens are stored in
// httpOnly cookies, which browser JavaScript cannot read, so the browser never talks to
// Supabase directly. A user's role comes from the app_users table, which only the
// server can write, never from anything the browser sends.

import { ACCESS_COOKIE } from "./cookies";

export type SessionUser = { id: string; email: string; displayName: string; role: Role; language: Language | null };

export type SignInResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "wrong_details" | "not_confirmed" | "server_setup" };

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await authClient().auth.signInWithPassword({ email, password });
  if (!error && data.session) return { ok: true, session: data.session };
  // Log the code only, never the email or password, so set-up problems can be found in the host's logs.
  console.warn("[auth] sign-in failed", error?.code ?? error?.status ?? "no_session");
  if (error?.code === "email_not_confirmed") return { ok: false, reason: "not_confirmed" };
  if (error?.code === "invalid_credentials" || error?.status === 400) return { ok: false, reason: "wrong_details" };
  return { ok: false, reason: "server_setup" };
}

/** Who is making this request? Checked against Supabase Auth every time. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await db()
    .from("app_users")
    // Every column, so a database that hasn't added preferred_language yet still signs in.
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) return null; // signed in to Supabase, but not a Tutor Compass user
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    displayName: profile.display_name,
    role: profile.role as Role,
    language: isLanguage(profile.preferred_language) ? profile.preferred_language : null,
  };
});

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string, public role?: Role) {
    super(message);
  }
}

/** Use at the start of every protected operation. */
export async function requireUser(role?: Role): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError(401, "Please sign in.");
  if (role && user.role !== role) throw new AuthError(403, `Only the ${role} can do this.`, role);
  return user;
}
