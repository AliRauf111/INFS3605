import { describe, expect, it } from "vitest";
import en from "@/locales/en";
import { loadLanguage } from "@/locales";
import { createI18n, fixedT, stripIsolates, type Translate } from "@/lib/i18n/core";
import { LANGUAGE_CODES, languageInfo, type Language } from "@/lib/i18n/languages";
import { inEnglish, inReplyLanguage } from "@/lib/i18n/reply-server";
import { aiLanguageInstruction, replyLanguage, tr } from "@/lib/i18n/reply";
import { PROPOSAL_ACTIONS, actionLabel, availableActions, canConfirm, canPrepare } from "@/lib/agent/permissions";
import { decisionTitle } from "@/lib/assistant/logic";
import { STATUSES, ROLES } from "@/lib/domain/types";

// Compass replies in the reader's language. These checks make sure the language only
// changes the words: who may do what, and which IDs, numbers and rules a reply mentions,
// stay exactly the same in every language.

type Tree = { [k: string]: string | Tree };
const PLURAL = /_(zero|one|two|few|many|other)$/;
function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === "string") out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const others = LANGUAGE_CODES.filter((c) => c !== "en") as Exclude<Language, "en">[];
const enFlat = flatten(en as unknown as Tree);
const replyKeys = Object.keys(enFlat).filter((k) => k.startsWith("reply."));

async function readerT(code: Language): Promise<Translate> {
  return fixedT(createI18n(code, { [code]: (await loadLanguage(code)) ?? undefined }), code);
}
const turn = <T>(code: Language, t: Translate, fn: () => T) => inReplyLanguage({ t, lang: code }, async () => fn());

// References and figures a reply quotes: policy and record IDs, file names and plain numbers.
const REFERENCE = /\b(?:KB-\d+|BK-\d+|FAM-\d+|INV-\d+|PAY-\d+|sql\/[\w-]+\.sql)\b/g;
const NUMBER = /(?<![\w{])\d+(?![\w}])/g;
const tokens = (s: string, re: RegExp) => [...new Set(stripIsolates(s).match(re) ?? [])].sort();

describe("Compass reply text", () => {
  it("covers every reply the server writes", () => {
    expect(replyKeys.length).toBeGreaterThan(700);
  });

  describe.each(others)("%s", (code) => {
    it("keeps every reference and number from the English reply", async () => {
      const flat = flatten((await loadLanguage(code)) as unknown as Tree);
      const problems: string[] = [];
      for (const key of replyKeys) {
        const text = flat[key] ?? flat[key.replace(PLURAL, "_other")];
        if (text === undefined) { problems.push(`missing ${key}`); continue; }
        for (const re of [REFERENCE, NUMBER]) {
          const want = tokens(enFlat[key], re);
          const have = tokens(text, re);
          const lost = want.filter((x) => !have.includes(x));
          if (lost.length) problems.push(`${key} lost ${lost.join(", ")}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it("is actually translated, not left in English", async () => {
      const t = await readerT(code);
      const same = await turn(code, t, () =>
        ["reply.turn.verdictRed", "reply.turn.verdictAmber", "reply.turn.verdictGreen", "reply.att.nothing", "reply.owner.sys.noGreen"]
          .filter((k) => tr(k as never) === enFlat[k]));
      expect(same).toEqual([]);
    });

    it("gives the same permissions as English", async () => {
      const t = await readerT(code);
      const english = inEnglish(() => ROLES.flatMap((role) => STATUSES.map((status) => availableActions(role, status).join())));
      const reader = await turn(code, t, () => ROLES.flatMap((role) => STATUSES.map((status) => availableActions(role, status).join())));
      expect(reader).toEqual(english);
      const okEnglish = inEnglish(() => PROPOSAL_ACTIONS.flatMap((a) => ROLES.map((r) => canPrepare(a, r, "awaiting_owner").ok)));
      const okReader = await turn(code, t, () => PROPOSAL_ACTIONS.flatMap((a) => ROLES.map((r) => canPrepare(a, r, "awaiting_owner").ok)));
      expect(okReader).toEqual(okEnglish);
      expect(canConfirm("owner", "admin")).toBe(false);
    });

    it("tells live AI to answer in the reader's language without changing rules", async () => {
      const t = await readerT(code);
      const line = await turn(code, t, () => aiLanguageInstruction());
      expect(line).toContain(`Write in ${languageInfo(code).english}`);
      expect(line).toContain("never soften, strengthen or change a rule, a colour or a decision");
    });
  });
});

describe("reply language for one turn", () => {
  it("is English outside a turn", () => {
    expect(replyLanguage()).toBe("en");
    expect(decisionTitle("red", false)).toBe("Owner Review Required");
    expect(aiLanguageInstruction()).toBe("Write in British English.");
  });

  it("follows the reader inside a turn and keeps saved text in English", async () => {
    const ta = await readerT("ta");
    await turn("ta", ta, () => {
      expect(replyLanguage()).toBe("ta");
      expect(decisionTitle("red", false)).not.toBe("Owner Review Required");
      expect(inEnglish(() => actionLabel("request.approve"))).toBe("Approve");
      expect(replyLanguage()).toBe("ta");
    });
  });

  it("keeps two readers' languages apart when their turns overlap", async () => {
    const [es, ar] = await Promise.all([readerT("es"), readerT("ar")]);
    const pause = () => new Promise((r) => setTimeout(r, 5));
    const run = (code: Language, t: Translate) =>
      inReplyLanguage({ t, lang: code }, async () => {
        const first = decisionTitle("amber", false);
        await pause();
        return [first, decisionTitle("amber", false), replyLanguage()];
      });
    const [a, b] = await Promise.all([run("es", es), run("ar", ar)]);
    expect(a[0]).toBe(a[1]);
    expect(b[0]).toBe(b[1]);
    expect(a[0]).not.toBe(b[0]);
    expect([a[2], b[2]]).toEqual(["es", "ar"]);
  });

  it("falls back to English for a reply key a language doesn't have", async () => {
    const t = fixedT(createI18n("vi", { vi: { reply: { decision: { green: "Trong thẩm quyền của bạn" } } } }), "vi");
    await turn("vi", t, () => {
      expect(decisionTitle("green", false)).toBe("Trong thẩm quyền của bạn");
      expect(decisionTitle("red", false)).toBe("Owner Review Required");
    });
  });
});
