"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createI18n, type Translate } from "@/lib/i18n/core";
import { makeFormat, type Format } from "@/lib/i18n/format";
import { LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE, languageInfo, textDirection, type Language } from "@/lib/i18n/languages";
import { loadLanguage } from "@/locales";

// Gives every client component the interface language. Changing it swaps the text in place:
// nothing reloads, so the page, open dialogs, Compass and anything typed into a form stay
// as they were. Then the server-drawn parts of the page are refreshed in the background
// (router.refresh keeps the browser's state) and the choice is saved.

type LanguageState = {
  language: Language;
  /** The language being loaded, while a change is under way. */
  pending: Language | null;
  /** The language that couldn't be loaded, if the last change failed. */
  failed: Language | null;
  setLanguage: (next: Language) => Promise<boolean>;
};

const LanguageContext = createContext<LanguageState | null>(null);

function applyToDocument(lang: Language) {
  const html = document.documentElement;
  html.lang = languageInfo(lang).htmlLang;
  html.dir = textDirection(lang);
}

export function I18nProvider({ lang, resources, children }: { lang: Language; resources: Record<string, unknown> | null; children: React.ReactNode }) {
  const [i18n] = useState(() => createI18n(lang, resources ? { [lang]: resources } : {}));
  const [language, setCurrent] = useState<Language>(lang);
  const [pending, setPending] = useState<Language | null>(null);
  const [failed, setFailed] = useState<Language | null>(null);
  const [announce, setAnnounce] = useState("");
  const [, startTransition] = useTransition();
  const router = useRouter();

  // The server decides the language on each full render (for example after signing in, when
  // the account's saved language takes over). Follow it.
  useEffect(() => {
    if (resources && !i18n.hasResourceBundle(lang, "translation")) i18n.addResourceBundle(lang, "translation", resources, true, true);
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
    setCurrent(lang);
    applyToDocument(lang);
  }, [lang, resources, i18n]);

  const setLanguage = useCallback(async (next: Language) => {
    setFailed(null);
    if (next === i18n.language) return true;
    setPending(next);
    try {
      if (!i18n.hasResourceBundle(next, "translation")) {
        const res = await loadLanguage(next);
        if (res) i18n.addResourceBundle(next, "translation", res, true, true);
      }
    } catch {
      // Nothing changes: the page stays readable in the language it was already in.
      setPending(null);
      setFailed(next);
      return false;
    }
    await i18n.changeLanguage(next);
    applyToDocument(next);
    setCurrent(next);
    setPending(null);
    setAnnounce(String(i18n.getFixedT(next)("language.changed", { language: languageInfo(next).native })));
    try {
      const res = await fetch("/api/preferences/language", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: next }) });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Couldn't reach the server: remember it on this device so the next page still uses it.
      document.cookie = `${LANGUAGE_COOKIE}=${next}; path=/; max-age=${LANGUAGE_COOKIE_MAX_AGE}; samesite=lax`;
    }
    startTransition(() => router.refresh());
    return true;
  }, [i18n, router]);

  const value = useMemo(() => ({ language, pending, failed, setLanguage }), [language, pending, failed, setLanguage]);
  return (
    <I18nextProvider i18n={i18n}>
      <LanguageContext.Provider value={value}>
        {children}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </LanguageContext.Provider>
    </I18nextProvider>
  );
}

export function useLanguage(): LanguageState {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside I18nProvider");
  return ctx;
}

/** The translator and the date, number and money formats for the current language. */
export function useI18n(): { t: Translate; fmt: Format; lang: Language } {
  // useTranslation re-renders the component whenever the language changes.
  const { t: raw, i18n } = useTranslation();
  const lang = (i18n.language as Language) ?? "en";
  const t = useMemo<Translate>(() => (key, options) => String(raw(key as string, options as never)), [raw]);
  const fmt = useMemo(() => makeFormat(lang, t), [lang, t]);
  return { t, fmt, lang };
}
