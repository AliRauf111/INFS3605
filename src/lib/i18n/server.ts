import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { loadLanguage } from "@/locales";
import { createI18n, fixedT, type Translate } from "./core";
import { makeFormat, type Format } from "./format";
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, pickLanguage, textDirection, type Language } from "./languages";

export type ServerI18n = {
  lang: Language;
  dir: "ltr" | "rtl";
  t: Translate;
  fmt: Format;
  /** The chosen language's text, handed to the browser so the first paint is already translated. */
  resources: Record<string, unknown> | null;
};

/**
 * The language for this page: the signed-in person's saved choice, then this device's
 * cookie, then English. Worked out once per request. If a translation can't be loaded the
 * page is shown in English rather than failing.
 */
export const getI18n = cache(async (): Promise<ServerI18n> => {
  const user = supabaseConfigured() ? await getSessionUser().catch(() => null) : null;
  const jar = await cookies();
  let lang = pickLanguage(user?.language, jar.get(LANGUAGE_COOKIE)?.value);
  let resources: Record<string, unknown> | null = null;
  try {
    resources = await loadLanguage(lang);
  } catch (e) {
    console.warn(`[i18n] could not load ${lang}, showing English`, e instanceof Error ? e.message : e);
    lang = DEFAULT_LANGUAGE;
  }
  const t = fixedT(createI18n(lang, resources ? { [lang]: resources } : {}), lang);
  return { lang, dir: textDirection(lang), t, fmt: makeFormat(lang, t), resources };
});
