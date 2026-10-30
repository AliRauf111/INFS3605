import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/locales/en";
import { loadLanguage } from "@/locales";
import { createI18n, enT, fixedT, stripIsolates, type ResourceMap } from "@/lib/i18n/core";
import { LANGUAGES, LANGUAGE_CODES, isLanguage, pickLanguage, textDirection, type Language } from "@/lib/i18n/languages";

// Checks every translation against the English text, so a missing key, a dropped
// placeholder or a broken plural shows up here rather than on someone's screen.

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
const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).filter((p) => p !== "count").sort();
const baseKeys = (flat: Record<string, string>) => new Set(Object.keys(flat).map((k) => k.replace(PLURAL, "")));

const enFlat = flatten(en as unknown as Tree);
const others = LANGUAGE_CODES.filter((c) => c !== "en") as Exclude<Language, "en">[];

describe("languages", () => {
  it("offers exactly the fourteen agreed languages, English first", () => {
    expect(LANGUAGE_CODES).toEqual([
      "en", "zh-Hans", "ar", "vi", "yue-Hant", "pa", "el", "it", "hi", "es", "ta", "te", "mr", "bn",
    ]);
    expect(LANGUAGES.every((l) => l.native && l.english)).toBe(true);
  });
  it("keeps Mandarin and Cantonese separate", () => {
    expect(isLanguage("zh-Hans")).toBe(true);
    expect(isLanguage("yue-Hant")).toBe(true);
    expect(isLanguage("zh")).toBe(false);
  });
  it("only Arabic is right to left", () => {
    expect(LANGUAGE_CODES.filter((c) => textDirection(c) === "rtl")).toEqual(["ar"]);
  });
  it("names Tamil, Telugu, Marathi and Bengali in their own scripts", () => {
    const native = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.native]));
    expect(native).toMatchObject({ ta: "தமிழ்", te: "తెలుగు", mr: "मराठी", bn: "বাংলা" });
  });
  it("the database check allows every listed language", () => {
    const sql = readFileSync("supabase/migrations/20261030000002_language_preference.sql", "utf8");
    for (const code of LANGUAGE_CODES) expect(sql).toContain(`'${code}'`);
  });
  it("picks the account choice, then the device choice, then English", () => {
    expect(pickLanguage("vi", "es")).toBe("vi");
    expect(pickLanguage(null, "es")).toBe("es");
    expect(pickLanguage(undefined, undefined)).toBe("en");
    expect(pickLanguage("klingon", "fr")).toBe("en");
  });
});

describe.each(others)("%s translation", (code) => {
  it("loads, has every English key and no unknown keys", async () => {
    const res = (await loadLanguage(code)) as Tree;
    const flat = flatten(res);
    const missing = [...baseKeys(enFlat)].filter((k) => !baseKeys(flat).has(k));
    const unknown = [...baseKeys(flat)].filter((k) => !baseKeys(enFlat).has(k));
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("keeps every placeholder", async () => {
    const flat = flatten((await loadLanguage(code)) as Tree);
    const enByBase = new Map<string, string>();
    for (const [k, v] of Object.entries(enFlat)) enByBase.set(k.replace(PLURAL, ""), v);
    const broken = Object.entries(flat).filter(([k, v]) => {
      const want = placeholders(enByBase.get(k.replace(PLURAL, "")) ?? "");
      return want.join() !== placeholders(v).join();
    });
    expect(broken.map(([k]) => k)).toEqual([]);
  });

  it("has an _other form for every plural", async () => {
    const flat = flatten((await loadLanguage(code)) as Tree);
    const plurals = Object.keys(enFlat).filter((k) => k.endsWith("_other"));
    expect(plurals.filter((k) => !(k in flat))).toEqual([]);
  });
});

describe("translating", () => {
  async function tFor(code: Language, resources?: ResourceMap) {
    const res = resources ?? { [code]: (await loadLanguage(code)) ?? undefined };
    return fixedT(createI18n(code, res), code);
  }

  it("uses plural forms", async () => {
    expect(enT("schedule.lessonCount", { count: 1 })).toBe("1 lesson");
    expect(enT("schedule.lessonCount", { count: 3 })).toBe("3 lessons");
    const ar = await tFor("ar");
    expect(stripIsolates(ar("schedule.lessonCount", { count: 2 }))).toBe("درسان");
    expect(stripIsolates(ar("schedule.lessonCount", { count: 5 }))).toContain("دروس");
  });

  it("uses one and other plural forms in Tamil, Telugu, Marathi and Bengali", async () => {
    const ta = await tFor("ta");
    expect(ta("schedule.lessonCount", { count: 1 })).toBe("1 வகுப்பு");
    expect(ta("schedule.lessonCount", { count: 4 })).toBe("4 வகுப்புகள்");
    const te = await tFor("te");
    expect(te("schedule.lessonCount", { count: 2 })).toBe("2 క్లాసులు");
    const bn = await tFor("bn");
    expect(bn("schedule.lessonCount", { count: 3 })).toBe("3টি ক্লাস");
    const mr = await tFor("mr");
    expect(mr("rules.range.days", { count: 1 })).toBe("1 दिवस");
  });

  it("writes Marathi and Bengali numbers with Western digits, like the stored records", () => {
    const intl = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.intl]));
    expect(new Intl.NumberFormat(intl.mr).format(1042)).toBe("1,042");
    expect(new Intl.NumberFormat(intl.bn).format(42)).toBe("42");
  });

  it("falls back to English when a translation is missing", async () => {
    const t = await tFor("vi", { vi: { settings: { title: "Cài đặt" } } });
    expect(t("settings.title")).toBe("Cài đặt");
    expect(t("shell.signOut")).toBe("Sign Out");
  });

  it("never shows a raw key", async () => {
    const t = await tFor("es", {});
    expect(t("not.a.real.key" as never)).toBe("");
    expect(t("not.a.real.key" as never, { defaultValue: "Fallback" })).toBe("Fallback");
  });

  it("keeps names and references readable inside Arabic sentences", async () => {
    const ar = await tFor("ar");
    const text = ar("schedule.booking", { id: "BK-1042" });
    expect(text).toContain("⁨BK-1042⁩");
    expect(stripIsolates(text)).toContain("BK-1042");
  });

  it("leaves stored values untouched", async () => {
    const zh = await tFor("zh-Hans");
    expect(stripIsolates(zh("subjects.added", { course: "Mathematics Advanced", name: "Mia Chen" }))).toContain("Mathematics Advanced");
  });
});

describe("saved preference", () => {
  it("demo reset doesn't touch accounts, so language survives a reset", () => {
    const reset = readFileSync("supabase/migrations/20261027000001_demo_reset.sql", "utf8");
    expect(reset).not.toMatch(/app_users/);
  });
  it("the language route only updates the signed-in person's own row", () => {
    const route = readFileSync("src/app/api/preferences/language/route.ts", "utf8");
    expect(route).toMatch(/\.update\(\{ preferred_language: language \}\)\.eq\("id", user\.id\)/);
  });
});
