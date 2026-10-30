import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { setReplySource } from "./reply";
import { languageInfo, type Language } from "./languages";
import { enT, type Translate } from "./core";

// Each request gets its own language, even when several people use Compass at once.
const store = new AsyncLocalStorage<{ t: Translate; lang: Language; intl: string }>();
setReplySource(() => store.getStore());

/** Run one Compass turn with its replies written in the reader's language. */
export function inReplyLanguage<T>(i18n: { t: Translate; lang: Language }, fn: () => Promise<T>): Promise<T> {
  return store.run({ t: i18n.t, lang: i18n.lang, intl: languageInfo(i18n.lang).intl }, fn);
}

/** The same, for a route: reads the signed-in person's language first. */
export async function inReaderLanguage<T>(fn: () => Promise<T>): Promise<T> {
  const { getI18n } = await import("./server");
  return inReplyLanguage(await getI18n(), fn);
}

/** Run fn with English replies, for text that is saved, such as notes recorded with a decision. */
export function inEnglish<T>(fn: () => T): T {
  return store.run({ t: enT, lang: "en", intl: "en-AU" }, fn);
}
