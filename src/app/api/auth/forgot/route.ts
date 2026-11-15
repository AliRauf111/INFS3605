import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { FLOW_COOKIE, FLOW_MAX_AGE, cookieOptions, encodeFlow } from "@/lib/auth/cookies";
import { flowClient } from "@/lib/db/supabase";

// Sends a password reset link. The answer is the same whether or not the email has an
// account, so nobody can use this to find out who works at the business.

const Forgot = z.object({ email: z.email("Enter a valid email address.").max(200) }).strict();

export const POST = apiRoute(async (req) => {
  const parsed = Forgot.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Enter your email address.");
  const { client, verifier } = flowClient();
  const { error } = await client.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: new URL("/api/auth/callback", req.nextUrl.origin).toString(),
  });
  if (error) {
    console.warn("[auth] reset email failed", error.code ?? error.status);
    if (error.code === "over_email_send_rate_limit" || error.status === 429) throw new ApiError(429, "Too many emails have been sent. Wait a few minutes and try again.");
  }
  const res = NextResponse.json({ ok: true });
  const v = verifier();
  if (v) res.cookies.set(FLOW_COOKIE, encodeFlow({ v, kind: "recovery", next: "/" }), cookieOptions(FLOW_MAX_AGE));
  return res;
});
