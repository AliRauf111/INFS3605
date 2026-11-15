import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { FLOW_COOKIE, FLOW_MAX_AGE, cookieOptions, encodeFlow } from "@/lib/auth/cookies";
import { flowClient } from "@/lib/db/supabase";
import { getI18n } from "@/lib/i18n/server";
import type { TKey } from "@/lib/i18n/core";

// Creates a Supabase account. It does not give access: the owner still has to approve the
// person in Approval Alley before they can sign in, because roles live in app_users,
// which only the server writes.

const Signup = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
}).strict();

const FIELD_ERRORS: Record<string, TKey> = { name: "auth.api.enterName", email: "auth.api.validEmail", password: "auth.passwordShort" };

export const POST = apiRoute(async (req) => {
  const parsed = Signup.safeParse(await readJson(req));
  const { t } = await getI18n();
  if (!parsed.success) throw new ApiError(400, t(FIELD_ERRORS[String(parsed.error.issues[0]?.path[0])] ?? "auth.api.checkForm"));
  const { name, email, password } = parsed.data;
  const { client, verifier } = flowClient();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { display_name: name }, emailRedirectTo: new URL("/api/auth/callback", req.nextUrl.origin).toString() },
  });
  if (error && error.code !== "user_already_exists" && error.code !== "email_exists") {
    console.warn("[auth] sign-up failed", error.code ?? error.status);
    if (error.code === "weak_password") throw new ApiError(400, t("auth.api.weakPassword"));
    if (error.code === "signup_disabled") throw new ApiError(403, t("auth.api.signupOff"));
    if (error.code === "over_email_send_rate_limit" || error.status === 429) throw new ApiError(429, t("auth.api.tooManyEmails"));
    throw new ApiError(503, t("auth.api.signupDown"));
  }
  // The same answer whether or not the email was already registered, so accounts can't be guessed.
  const needsConfirm = !data?.session;
  const res = NextResponse.json({ ok: true, needsConfirm });
  const v = verifier();
  if (v && needsConfirm) res.cookies.set(FLOW_COOKIE, encodeFlow({ v, kind: "signup", next: "/" }), cookieOptions(FLOW_MAX_AGE));
  return res;
});
