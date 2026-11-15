import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { RECOVERY_COOKIE } from "@/lib/auth/cookies";
import { db } from "@/lib/db/supabase";

// Sets a new password. Only works straight after opening a reset link, which leaves a
// short-lived httpOnly cookie for that one account.

const Reset = z.object({ password: z.string().min(8, "Use at least 8 characters for your password.").max(200) }).strict();

export const POST = apiRoute(async (req) => {
  const token = req.cookies.get(RECOVERY_COOKIE)?.value;
  if (!token) throw new ApiError(401, "This reset link has expired. Ask for a new one from the sign-in page.");
  const parsed = Reset.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Enter a new password.");
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "This reset link has expired. Ask for a new one from the sign-in page.");
  const update = await db().auth.admin.updateUserById(data.user.id, { password: parsed.data.password });
  if (update.error) {
    console.warn("[auth] password update failed", update.error.code ?? update.error.status);
    if (update.error.code === "weak_password") throw new ApiError(400, "Choose a longer password that is harder to guess.");
    throw new ApiError(503, "The password couldn't be changed right now. Try again later.");
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(RECOVERY_COOKIE);
  return res;
});
