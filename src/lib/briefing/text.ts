import type { Translate } from "@/lib/i18n/core";
import type { Format } from "@/lib/i18n/format";
import { sydneyDate } from "@/lib/workflows/dates";
import type { BriefingAction, BriefingDetail, Comparison, Evidence, Period, Recommendation, Source, Warning } from "./types";

// The words for a briefing, in the reader's language. Shared by the page, the Overview card,
// Compass and the email, so they always say the same thing. Figures are formatted here,
// never rewritten: amounts stay in Australian dollars and times in Sydney time.

type K = Parameters<Translate>[0];

const isMoney = (k: string) => /Cents$/.test(k);

/** Turn a recommendation's figures into translation values: amounts become money. */
export function params(p: Record<string, number | string>, fmt: Format): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) out[k] = typeof v === "number" && isMoney(k) ? fmt.money(v, { whole: true }) : v;
  if (typeof p.overdueCents === "number") out.amount = fmt.money(p.overdueCents, { whole: true });
  return out;
}

export function recTitle(r: Recommendation, t: Translate, fmt: Format): string {
  return t(`briefing.rec.${r.kind}.title` as K, params(r.params, fmt));
}
export function recWhy(r: Recommendation, t: Translate, fmt: Format): string {
  return t(`briefing.rec.${r.kind}.why` as K, params(r.params, fmt));
}
export function recNext(r: Recommendation, t: Translate, fmt: Format): string {
  return t(`briefing.rec.${r.kind}.next` as K, params(r.params, fmt));
}
export function recExplain(r: Recommendation, t: Translate, fmt: Format): string {
  return t(`briefing.rec.${r.kind}.explain` as K, params(r.params, fmt));
}
export function recImpact(r: Recommendation, t: Translate, fmt: Format): string | null {
  if (!r.impact) return null;
  if (r.kind === "overdue" && r.impact.cents !== undefined) return t("briefing.rec.overdue.impact", { amount: fmt.money(r.impact.cents, { whole: true }), count: r.impact.count ?? 0 });
  if (r.kind === "cover") return t("briefing.rec.cover.impact", { count: r.impact.count ?? 0 });
  return null;
}

export function actionLabel(a: BriefingAction, t: Translate): string {
  return t(`briefing.actions.${a.label}` as K);
}

export function evidenceLine(e: Evidence, t: Translate, fmt: Format, now = new Date()): string {
  switch (e.kind) {
    case "family":
      return t("briefing.evidence.family", { name: e.name ?? "", refs: e.ref, amount: fmt.money(e.cents ?? 0, { whole: true }), days: e.days ?? 0, state: t(`briefing.finance.state.${(e.text ?? "eligible") as "eligible"}`) });
    case "message":
      return e.hours !== undefined
        ? t("briefing.evidence.message", { ref: e.ref, name: e.name ?? "", text: e.text ?? "", hours: e.hours })
        : t("briefing.evidence.messageSent", { ref: e.ref, name: e.name ?? "", when: e.at ? fmt.friendly(e.at, now, true) : "" });
    case "request":
      return t("briefing.evidence.request", { ref: e.ref, text: e.text ? t(`domain.requestType.${e.text as "refund"}`) : "", when: e.at ? fmt.friendly(e.at, now, true) : "" });
    case "lesson":
      return t("briefing.evidence.lesson", { ref: e.ref, text: e.text ?? "", name: e.name ?? "", when: e.at ? fmt.dateTime(e.at) : "" });
    case "retention":
      return t("briefing.evidence.retention");
    default:
      return e.ref;
  }
}

export function periodLabel(p: Period, t: Translate, fmt: Format): string {
  const day = (d: string) => fmt.date(new Date(`${d}T12:00:00Z`), { weekday: "short", day: "numeric", month: "short" });
  return t("briefing.period", { start: day(p.startDay), end: day(p.endDay) });
}

export function compareValue(c: Comparison, which: "current" | "previous", t: Translate, fmt: Format): string {
  const v = c[which];
  if (v === null) return "–";
  if (c.key === "outstandingCents") return fmt.money(v, { whole: true });
  if (c.key === "avgResponseHours") return t("briefing.compare.hours", { n: fmt.number(v, { maximumFractionDigits: 1 }) });
  return fmt.number(v);
}

/** "Unresolved enquiries decreased from 11 to 6 this week." */
export function compareSentence(c: Comparison, t: Translate, fmt: Format): string {
  if (c.verdict === "insufficient") return `${t(`briefing.compare.key.${c.key}`)}: ${t("briefing.compare.insufficient")}`;
  const metric = t(`briefing.compare.key.${c.key}`);
  const from = compareValue(c, "previous", t, fmt);
  const to = compareValue(c, "current", t, fmt);
  const dir = c.change === 0 ? "same" : (c.change ?? 0) < 0 ? "down" : "up";
  return t(`briefing.compare.sentence.${dir}`, { metric, from, to });
}

export function sourceLine(s: Source, t: Translate): string {
  return `${t(`briefing.source.${s.id}`)}: ${t(`briefing.sourceState.${s.state}`)}`;
}

export function warningLine(w: Warning, t: Translate, fmt: Format, now = new Date()): string {
  const source = t(`briefing.source.${w.source}`);
  return t(`briefing.warning.${w.kind}`, { source, when: w.at ? fmt.friendly(w.at, now, true) : "" });
}

/** The plain sentence Compass gives for each section. */
export function sectionSays(section: "finance" | "comms" | "lessons", d: BriefingDetail, t: Translate, fmt: Format, days: number): string | null {
  if (section === "finance") {
    const f = d.finance;
    if (!f) return null;
    if (!f.overdueInvoices) return t("briefing.says.financeNone");
    return t("briefing.says.finance", { count: f.overdueInvoices, amount: fmt.money(f.overdueCents, { whole: true }), over: f.over14Invoices, days, families: f.eligibleFamilies });
  }
  if (section === "comms") {
    const c = d.comms;
    if (!c) return null;
    const parents = c.open.filter((x) => x.category !== "tutor_absence");
    if (!parents.length) return t("briefing.says.commsNone");
    return t("briefing.says.comms", { count: parents.length, lessonChanges: c.lessonChanges, billing: c.billing, hours: parents[0].ageHours });
  }
  const l = d.lessons;
  return l.needCover.length || l.pendingChanges
    ? t("briefing.says.lessons", { upcoming: l.upcoming, cover: l.needCover.length, changes: l.pendingChanges })
    : t("briefing.says.lessonsQuiet", { upcoming: l.upcoming });
}

export function shortDay(iso: string, fmt: Format): string {
  return fmt.date(new Date(`${sydneyDate(iso)}T12:00:00Z`), { day: "numeric", month: "short" });
}
