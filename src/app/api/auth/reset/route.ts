import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { RECOVERY_COOKIE } from "@/lib/auth/cookies";
import { db } from "@/lib/db/supabase";
import { getI18n } from "@/lib/i18n/server";

// Sets a new password. Only works straight after opening a reset link, which leaves a
// short-lived httpOnly cookie for that one account.

const Reset = z.object({ password: z.string().min(8).max(200) }).strict();

export const POST = apiRoute(async (req) => {
  const { t } = await getI18n();
  const token = req.cookies.get(RECOVERY_COOKIE)?.value;
  if (!token) throw new ApiError(401, t("auth.api.resetExpired"));
  const parsed = Reset.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, t("auth.passwordShort"));
  const { data, error } = await db().auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, t("auth.api.resetExpired"));
  const update = await db().auth.admin.updateUserById(data.user.id, { password: parsed.data.password });
  if (update.error) {
    console.warn("[auth] password update failed", update.error.code ?? update.error.status);
    if (update.error.code === "weak_password") throw new ApiError(400, t("auth.api.weakPassword"));
    throw new ApiError(503, t("auth.api.resetDown"));
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(RECOVERY_COOKIE);
  return res;
});
