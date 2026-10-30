import type { Resources } from "@/lib/i18n/core";
import type { Language } from "@/lib/i18n/languages";

// Each language other than English is its own file bundle, loaded only when it is chosen,
// so nobody downloads ten languages to read one. English is built in (see src/lib/i18n/core.ts).
const LOADERS: Record<Exclude<Language, "en">, () => Promise<{ default: Record<string, unknown> }>> = {
  "zh-Hans": () => import("./zh-Hans"),
  ar: () => import("./ar"),
  vi: () => import("./vi"),
  "yue-Hant": () => import("./yue-Hant"),
  pa: () => import("./pa"),
  el: () => import("./el"),
  it: () => import("./it"),
  hi: () => import("./hi"),
  es: () => import("./es"),
};

/** The interface text for one language. Throws if it can't be loaded, for example offline. */
export async function loadLanguage(lang: Language): Promise<Resources | Record<string, unknown> | null> {
  if (lang === "en") return null;
  return (await LOADERS[lang]()).default;
}
