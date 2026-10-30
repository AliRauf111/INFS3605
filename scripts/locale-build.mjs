// Builds the translation files for one or more languages from a flat source file.
// Translators work in src/locales/_sources/<lang>.txt (or <lang>.1.txt, <lang>.2.txt): one "area.key.sub=Text" per line,
// in the same order as English. This script checks every line against English and writes
// src/locales/<lang>/<area>.json, then the index. Run: npm run i18n:build -- vi el
//
// Plurals: give the forms your language uses (key_one, key_other, Arabic key_zero..key_many).
// A missing form is filled from key_other, and forms the language doesn't use are dropped.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SUFFIX = /_(zero|one|two|few|many|other)$/;
const flatten = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const english = {};
for (const f of readdirSync("src/locales/en").filter((f) => f.endsWith(".json")).sort()) {
  Object.assign(english, flatten(JSON.parse(readFileSync(`src/locales/en/${f}`, "utf8")), f.slice(0, -5)));
}
const placeholders = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(",");

const langs = process.argv.slice(2);
let failed = false;
for (const lang of langs) {
  const pluralLang = lang === "yue-Hant" ? "yue" : lang;
  const forms = new Intl.PluralRules(pluralLang).resolvedOptions().pluralCategories;
  // A language can be split into parts: <lang>.1.txt, <lang>.2.txt and so on.
  const parts = readdirSync("src/locales/_sources").filter((f) => f === `${lang}.txt` || (f.startsWith(`${lang}.`) && /^\d+\.txt$/.test(f.slice(lang.length + 1)))).sort();
  if (!parts.length) { console.error(`${lang}: no source file in src/locales/_sources`); failed = true; continue; }
  const lines = parts.flatMap((f) => readFileSync(`src/locales/_sources/${f}`, "utf8").split("\n"));
  const given = {};
  lines.forEach((line, i) => {
    if (!line.trim() || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 0) { console.error(`${lang}:${i + 1}: no "="`); failed = true; return; }
    given[line.slice(0, eq).trim()] = line.slice(eq + 1).replace(/\s+$/, "");
  });
  const out = {};
  const problems = [];
  const bases = new Set(Object.keys(english).filter((k) => SUFFIX.test(k)).map((k) => k.replace(SUFFIX, "")));
  for (const key of Object.keys(english)) {
    if (SUFFIX.test(key)) continue;
    if (!(key in given)) problems.push(`missing ${key}`);
    else out[key] = given[key];
  }
  for (const base of bases) {
    const other = given[`${base}_other`];
    if (other === undefined) { problems.push(`missing ${base}_other`); continue; }
    for (const form of forms) out[`${base}_${form}`] = given[`${base}_${form}`] ?? other;
  }
  for (const key of Object.keys(given)) {
    const base = key.replace(SUFFIX, "");
    if (!(key in english) && !bases.has(base)) problems.push(`unknown key ${key}`);
  }
  // Every placeholder in English must be kept (count may be left out of a plural form).
  for (const [key, text] of Object.entries(out)) {
    const enKey = key in english ? key : `${key.replace(SUFFIX, "")}_other`;
    const want = placeholders(english[enKey]).split(",").filter(Boolean);
    const have = placeholders(text).split(",").filter(Boolean);
    const missing = want.filter((p) => !have.includes(p) && !(p === "count" && SUFFIX.test(key)));
    const extra = have.filter((p) => !want.includes(p));
    if (missing.length || extra.length) problems.push(`placeholders in ${key}: missing [${missing}] extra [${extra}]`);
    if (!text.trim()) problems.push(`empty ${key}`);
  }
  if (problems.length) { failed = true; console.error(`${lang}: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`); continue; }
  const areas = {};
  for (const [key, text] of Object.entries(out)) {
    const [area, ...rest] = key.split(".");
    let node = (areas[area] ??= {});
    rest.slice(0, -1).forEach((p) => { node = node[p] ??= {}; });
    node[rest[rest.length - 1]] = text;
  }
  if (!existsSync(`src/locales/${lang}`)) mkdirSync(`src/locales/${lang}`);
  for (const [area, data] of Object.entries(areas)) writeFileSync(`src/locales/${lang}/${area}.json`, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${lang}: wrote ${Object.keys(areas).length} areas, ${Object.keys(out).length} strings (plural forms: ${forms.join(", ")}).`);
}
execFileSync("node", ["scripts/locale-index.mjs"], { stdio: "inherit" });
if (failed) process.exit(1);
