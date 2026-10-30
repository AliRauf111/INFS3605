import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { getSessionUser } from "@/lib/auth/session";
import { db, supabaseConfigured } from "@/lib/db/supabase";
import { getI18n } from "@/lib/i18n/server";
import { LANGUAGE_CODES, LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE } from "@/lib/i18n/languages";

// Saves the interface language. Signed in, it is saved to that person's own account row
// (the id comes from their session, never from the browser), so it follows them to other
// devices. Signed out, or before the database has the column, it is kept in a cookie on
// this device only. A signed-in choice never goes into the device cookie, so signing out
// doesn't leave one person's language behind for the next.

const Body = z.object({ language: z.enum(LANGUAGE_CODES as [string, ...string[]]) }).strict();

export const POST = apiRoute(async (req) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, (await getI18n()).t("errors.unknownLanguage"));
  const language = parsed.data.language;

  let saved: "account" | "device" = "device";
  const user = supabaseConfigured() ? await getSessionUser().catch(() => null) : null;
  if (user) {
    const { error } = await db().from("app_users").update({ preferred_language: language }).eq("id", user.id);
    if (!error) saved = "account";
    else console.warn("[language] not saved to the account, keeping it on this device", error.code ?? error.message);
  }

  const res = NextResponse.json({ ok: true, language, saved });
  if (saved === "device") {
    res.cookies.set(LANGUAGE_COOKIE, language, { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: LANGUAGE_COOKIE_MAX_AGE });
  }
  return res;
});
