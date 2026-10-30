import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { FLOW_COOKIE, FLOW_MAX_AGE, cookieOptions, encodeFlow } from "@/lib/auth/cookies";
import { flowClient } from "@/lib/db/supabase";
import { getI18n } from "@/lib/i18n/server";

// Sends a password reset link. The answer is the same whether or not the email has an
// account, so nobody can use this to find out who works at the business.

const Forgot = z.object({ email: z.email().max(200) }).strict();

export const POST = apiRoute(async (req) => {
  const parsed = Forgot.safeParse(await readJson(req));
  const { t } = await getI18n();
  if (!parsed.success) throw new ApiError(400, t("auth.api.validEmail"));
  const { client, verifier } = flowClient();
  const { error } = await client.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: new URL("/api/auth/callback", req.nextUrl.origin).toString(),
  });
  if (error) {
    console.warn("[auth] reset email failed", error.code ?? error.status);
    if (error.code === "over_email_send_rate_limit" || error.status === 429) throw new ApiError(429, t("auth.api.tooManyEmails"));
  }
  const res = NextResponse.json({ ok: true });
  const v = verifier();
  if (v) res.cookies.set(FLOW_COOKIE, encodeFlow({ v, kind: "recovery", next: "/" }), cookieOptions(FLOW_MAX_AGE));
  return res;
});
