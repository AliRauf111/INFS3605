import { createInstance, type i18n as I18n } from "i18next";
import en from "@/locales/en";
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, textDirection, type Language } from "./languages";

// One place that sets up i18next, used the same way on the server and in the browser.
// The interface text lives in src/locales/<language>/*.json. English is always loaded and
// is the fallback for anything a translation doesn't have yet, so a raw key is never shown.

export type Resources = typeof en;

// Every key in the English files, as "area.key.subkey", with plural endings (_one, _other
// and so on) folded into the base key. A mistyped or missing key fails the type check
// instead of showing a raw key on screen. Kept as a plain union because i18next's own key
// typing made the type check take minutes.
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type Base<K extends string> = K extends `${infer B}_${PluralSuffix}` ? B : K;
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${Base<K>}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type TKey = Leaves<Resources>;
export type TOptions = { count?: number; defaultValue?: string; [value: string]: unknown };
export type Translate = (key: TKey, options?: TOptions) => string;
export type ResourceMap = Partial<Record<Language, Resources | Record<string, unknown>>>;

// First Strong Isolate and Pop Directional Isolate. In right-to-left text, each value put
// into a sentence (a name, booking reference, email address or number) is wrapped in these
// invisible marks, so it reads in its own direction and doesn't scramble the words around it.
const FSI = "⁨";
const PDI = "⁩";

export function createI18n(lng: Language, resources: ResourceMap = {}): I18n {
  const inst = createInstance();
  const bundles: Record<string, { translation: unknown }> = { en: { translation: en } };
  for (const [code, res] of Object.entries(resources)) if (res && code !== "en") bundles[code] = { translation: res };
  void inst.init({
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGE_CODES,
    load: "currentOnly",
    resources: bundles as never,
    initAsync: false,
    returnNull: false,
    returnEmptyString: false, // an empty translation falls back to English
    interpolation: {
      // React escapes text itself. The escape step is used only for the direction marks above.
      escapeValue: true,
      escape: (value: string) => (textDirection(inst.language as Language) === "rtl" ? `${FSI}${value}${PDI}` : value),
    },
    // A key missing in every language shows its default text, or nothing; never the key itself.
    parseMissingKeyHandler: (_key: string, defaultValue?: string) => defaultValue ?? "",
    react: { useSuspense: false },
  } as never);
  return inst;
}

/** English text, for code that runs outside a page (tests, logs, the AI prompts) and as the default. */
export const enT: Translate = fixedT(createI18n("en"), "en");

/** A translator for one language from an i18next instance, typed with this app's keys. */
export function fixedT(inst: I18n, lng: Language): Translate {
  const t = inst.getFixedT(lng);
  return (key, options) => String(t(key as string, options as never));
}

/** Remove the direction marks, for text that is compared or copied rather than shown. */
export function stripIsolates(text: string): string {
  return text.replace(/[⁨⁩]/g, "");
}
