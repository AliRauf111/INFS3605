import { enT, type Translate } from "./core";
import { languageInfo, type Language } from "./languages";
import { makeFormat, type Format } from "./format";

// Compass writes its replies on the server, in code the browser also imports for types and
// small helpers. The assistant routes set the reader's language for one turn (see
// reply-server.ts). Anywhere else, including tests, replies are written in English.
// Text that is saved, such as notes to the owner and the activity log, stays in English
// on purpose: records read the same for everyone.

type ReplyLanguage = { t: Translate; lang: Language; intl: string };

let current: () => ReplyLanguage | undefined = () => undefined;

export function setReplySource(get: () => ReplyLanguage | undefined) {
  current = get;
}

/** Translate a Compass reply into the reader's language. */
export const tr: Translate = (key, options) => (current()?.t ?? enT)(key, options);

export const replyLanguage = (): Language => current()?.lang ?? "en";

/** The locale for dates and times inside a reply. */
export const replyIntl = (): string => current()?.intl ?? "en-AU";

/**
 * A sentence for live AI prompts that write words the reader sees, so the AI answers in
 * the reader's language. Rules, amounts, IDs and decisions are never left to the AI.
 */
export function aiLanguageInstruction(): string {
  const lang = replyLanguage();
  if (lang === "en") return "Write in British English.";
  const { english } = languageInfo(lang);
  return `Write in ${english}. Keep booking, invoice and request IDs (such as BK-1042), amounts, dates, policy IDs and product names (Tutor Compass, Compass AI, Knowledge Hub) exactly as given. Keep the meaning exact: never soften, strengthen or change a rule, a colour or a decision.`;
}

/** Numbers, money and dates for the reader, for helpers that take a Format. */
export const replyFormat = (): Format => makeFormat(replyLanguage(), tr);
