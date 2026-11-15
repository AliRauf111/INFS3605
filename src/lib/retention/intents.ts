import type { Assessment, RetentionContact } from "./types";

// Recognises Student Retention questions typed into Compass, with plain patterns so it
// works without live AI. Checked before the request tools, and only for clear retention
// wording, so ordinary requests keep their usual path.

export type RetentionIntent = { kind: "at_risk" | "why" | "cancellations" | "prepare" | "no_reply" | "outcomes" };

const RULES: Array<{ kind: RetentionIntent["kind"]; test: RegExp }> = [
  { kind: "prepare", test: /\b(prepare|draft|write|start)\b.{0,12}\bcheck[- ]?in\b/i },
  { kind: "why", test: /\bwhy\b.{0,60}\b(flagged|at[- ]risk|high[- ]risk|medium[- ]risk|risk of leaving)\b/i },
  { kind: "no_reply", test: /\b(parents?|families|family)\b.{0,40}\b(not|n't|never|yet to)\b.{0,12}\b(respond|repl)/i },
  { kind: "outcomes", test: /\b(outcomes?|results?)\b.{0,40}\b(retention|check[- ]?ins?)\b|\b(retention|check[- ]?in)\b.{0,20}\b(outcomes?|results?)\b/i },
  { kind: "cancellations", test: /\b(repeated|many|multiple|lots of|frequent|several|most)\b.{0,12}\bcancell?ations?\b|\bcancell?ing (a lot|often|repeatedly)\b/i },
  { kind: "at_risk", test: /\b(at[- ]risk of leaving|risk of leaving|might leave|likely to leave|about to leave|students? at[- ]risk|at[- ]risk students?|disengag\w*|student retention|retention (risk|flags?|alert|agent))\b/i },
];

export function detectRetention(text: string): RetentionIntent | null {
  for (const r of RULES) if (r.test.test(text)) return { kind: r.kind };
  return null;
}

/** The student a message names: by full or first name, or by the parent's name ("Priya's son"). */
export function findStudent(text: string, list: Assessment[], contacts: RetentionContact[]): Assessment | null {
  const lower = ` ${text.toLowerCase().replace(/[’']s\b/g, "").replace(/[^\p{L}\p{N}\s-]/gu, " ")} `;
  const has = (name: string) => lower.includes(` ${name.toLowerCase()} `);
  const byFull = list.find((a) => has(a.name));
  if (byFull) return byFull;
  const byFirst = list.filter((a) => has(a.name.split(/\s+/)[0]));
  if (byFirst.length === 1) return byFirst[0];
  if (byFirst.length > 1) return byFirst.sort((a, b) => b.score - a.score)[0];
  const parent = contacts.find((c) => has(c.name) || has(c.name.split(/\s+/)[0]));
  if (parent) return list.find((a) => a.contact?.id === parent.id) ?? null;
  return null;
}
