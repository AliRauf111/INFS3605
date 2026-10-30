import { DEFAULT_LANGUAGE, languageInfo, type Language } from "./languages";
import { enT, type Translate } from "./core";

// Dates, numbers and money for the chosen language. Only the presentation changes: times
// stay in Sydney time, amounts stay in Australian dollars and the values themselves are
// never rounded or converted.

export const TIME_ZONE = "Australia/Sydney";

export type Format = {
  lang: Language;
  locale: string;
  /** "$49.99" in English, "49,99 A$" in Italian. Missing amounts say "Not provided". */
  money: (cents: number | null | undefined, opts?: { whole?: boolean }) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  /** Date and time, for example "30 Oct 2026, 2:13 pm". Missing says "Not recorded". */
  dateTime: (iso: string | null | undefined) => string;
  date: (iso: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
  time: (iso: string | Date) => string;
  /** "Today, 2:13 pm", "Yesterday, 9:00 pm" or "14 Oct, 8:19 pm". In a sentence: "today, 2:13 pm". */
  friendly: (iso: string, now?: Date, inSentence?: boolean) => string;
  /** "Mathematics, English and Science". */
  list: (items: string[], type?: "conjunction" | "disjunction") => string;
};

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${locale}|${JSON.stringify(opts)}`;
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale, opts));
  return cache.get(key) as Intl.NumberFormat;
}
function df(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${locale}|${JSON.stringify(opts)}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(locale, { timeZone: TIME_ZONE, ...opts }));
  return cache.get(key) as Intl.DateTimeFormat;
}

const sydneyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });

export function makeFormat(lang: Language = DEFAULT_LANGUAGE, t: Translate = enT): Format {
  const locale = languageInfo(lang).intl;
  const asDate = (v: string | Date) => (typeof v === "string" ? new Date(v) : v);
  const time = (v: string | Date) => df(locale, { hour: "numeric", minute: "2-digit" }).format(asDate(v));
  return {
    lang,
    locale,
    money: (cents, opts) => {
      if (cents === null || cents === undefined) return t("common.notProvided");
      const whole = opts?.whole && cents % 100 === 0;
      return nf(locale, { style: "currency", currency: "AUD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
    },
    number: (n, opts = {}) => nf(locale, opts).format(n),
    dateTime: (iso) => {
      if (!iso) return t("common.notRecorded");
      return df(locale, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    },
    date: (v, opts = { day: "numeric", month: "short", year: "numeric" }) => df(locale, opts).format(asDate(v)),
    time,
    friendly: (iso, now = new Date(), inSentence = false) => {
      const d = new Date(iso);
      const at = time(d);
      if (sydneyDay(d) === sydneyDay(now)) return t(inSentence ? "time.todayAtInSentence" : "time.todayAt", { time: at });
      if (sydneyDay(d) === sydneyDay(new Date(now.getTime() - 86_400_000))) return t(inSentence ? "time.yesterdayAtInSentence" : "time.yesterdayAt", { time: at });
      const sameYear = sydneyDay(d).slice(0, 4) === sydneyDay(now).slice(0, 4);
      const date = df(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
      return t("time.dateAt", { date, time: at });
    },
    list: (items, type = "conjunction") => new Intl.ListFormat(locale, { style: "long", type }).format(items),
  };
}
