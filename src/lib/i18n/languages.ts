// The ten languages Tutor Compass is offered in. English is the default and the fallback
// for any text a translation doesn't have yet. Mandarin and Cantonese are separate
// languages with their own translations, not one Chinese with two scripts.
//
//   code      what i18next and the saved preference use (stable, never translated)
//   short     a one or two character tag for the header on small screens
//   htmlLang  the lang attribute, so screen readers and fonts pick the right language
//   intl      the locale for dates, numbers and money (Cantonese uses Hong Kong formats,
//             which browsers support more widely than "yue")

export const LANGUAGES = [
  { code: "en", short: "EN", english: "English", native: "English", htmlLang: "en-AU", intl: "en-AU", dir: "ltr" },
  { code: "zh-Hans", short: "普", english: "Mandarin (Simplified Chinese)", native: "普通话（简体中文）", htmlLang: "zh-Hans", intl: "zh-CN", dir: "ltr" },
  { code: "ar", short: "ع", english: "Arabic", native: "العربية", htmlLang: "ar", intl: "ar-u-nu-latn", dir: "rtl" },
  { code: "vi", short: "VI", english: "Vietnamese", native: "Tiếng Việt", htmlLang: "vi", intl: "vi-VN", dir: "ltr" },
  { code: "yue-Hant", short: "粵", english: "Cantonese (Traditional Chinese)", native: "廣東話（繁體中文）", htmlLang: "yue-Hant", intl: "zh-HK", dir: "ltr" },
  { code: "pa", short: "ਪੰ", english: "Punjabi (Gurmukhi)", native: "ਪੰਜਾਬੀ", htmlLang: "pa-Guru", intl: "pa-IN", dir: "ltr" },
  { code: "el", short: "EL", english: "Greek", native: "Ελληνικά", htmlLang: "el", intl: "el-GR", dir: "ltr" },
  { code: "it", short: "IT", english: "Italian", native: "Italiano", htmlLang: "it", intl: "it-IT", dir: "ltr" },
  { code: "hi", short: "हि", english: "Hindi", native: "हिन्दी", htmlLang: "hi", intl: "hi-IN", dir: "ltr" },
  { code: "es", short: "ES", english: "Spanish", native: "Español", htmlLang: "es", intl: "es-ES", dir: "ltr" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];
export type LanguageInfo = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as Language[];

/** The device cookie that remembers a visitor's choice. Signed-in choices are saved to the account instead. */
export const LANGUAGE_COOKIE = "tc-lang";
export const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLanguage(v: unknown): v is Language {
  return typeof v === "string" && (LANGUAGE_CODES as string[]).includes(v);
}

export function languageInfo(code: Language): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export function textDirection(code: Language): "ltr" | "rtl" {
  return languageInfo(code).dir;
}

/**
 * The language to start with: a signed-in person's saved choice, then this device's
 * choice, then English. Anything unrecognised is skipped.
 */
export function pickLanguage(account: unknown, device: unknown): Language {
  if (isLanguage(account)) return account;
  if (isLanguage(device)) return device;
  return DEFAULT_LANGUAGE;
}
