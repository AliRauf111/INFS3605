import "server-only";
import type { TurnCtx } from "@/lib/assistant/owner";
import type { Mood } from "@/lib/assistant/logic";
import { logActivity } from "@/lib/agent/activity";
import { replyFormat, tr } from "@/lib/i18n/reply";
import { compareSentence, evidenceLine, periodLabel, recNext, recTitle, recWhy, sectionSays } from "./text";
import type { BriefingIntent } from "./intents";
import { currentBriefing, isMissingBriefing, viewForUser } from "./server";
import type { BriefingView, Recommendation } from "./types";

// The Weekly Owner Briefing inside Compass. It answers from the same saved briefing as the
// Weekly Briefing page, with the same permissions: admins never see the owner's financial
// figures unless the owner allows it. Nothing here goes to the AI service, and nothing is
// changed or sent. Each answer links to the page or the existing workflow.

const say = (ctx: TurnCtx, text: string) => ctx.blocks.push({ kind: "text", text });
const PAGE = "/briefing";

function topRec(v: BriefingView, prefer?: Recommendation["kind"][]): Recommendation | null {
  const list = v.recommendations.filter((r) => r.kind !== "all_clear");
  return (prefer && list.find((r) => prefer.includes(r.kind))) || list[0] || v.recommendations[0] || null;
}

function recLink(r: Recommendation): { label: string; href: string } {
  const a = r.actions.find((x) => x.kind === "link");
  if (a && a.kind === "link") return { label: tr(`briefing.actions.${a.label}`), href: a.href };
  return { label: tr("briefing.compass.openRecs"), href: `${PAGE}#recommendations` };
}

export async function briefingTurn(ctx: TurnCtx, intent: BriefingIntent): Promise<Mood> {
  const t = tr;
  const fmt = replyFormat();
  let view: BriefingView;
  try {
    view = await viewForUser(ctx.user, await currentBriefing(ctx.user, new Date(), "compass"));
  } catch (e) {
    ctx.steps.push({ label: t("briefing.compass.step"), state: "failed" });
    ctx.blocks.push({ kind: "notice", tone: "error", text: isMissingBriefing(e) ? t("briefing.compass.notSetUp") : t("briefing.compass.unavailable") });
    return "error";
  }
  ctx.steps.push({ label: t("briefing.compass.step"), state: "done" });
  ctx.modeNote = view.mode === "demo" ? t("briefing.compass.noteDemo") : t("briefing.compass.note");
  const d = view.detail;
  const page = { label: t("briefing.compass.link"), href: PAGE };
  const period = periodLabel(view.period, t, fmt);
  const days = Number(view.recommendations.find((r) => r.kind === "overdue")?.params.days ?? 14);
  const recLines = (list: Recommendation[]) => list.map((r) => `${t(`briefing.priority.${r.priority}`)}: ${recTitle(r, t, fmt)}. ${recNext(r, t, fmt)}`);
  const headline = () => {
    say(ctx, t("briefing.compass.intro", { period, status: t(`briefing.overall.${view.overall}`) }));
    say(ctx, t("briefing.compass.headline", { students: view.headline.activeStudents, lessons: view.headline.upcomingLessons, done: view.headline.tasksCompleted }));
    if (!view.financeHidden && d?.finance) say(ctx, t("briefing.compass.headlineFinance", { overdue: d.finance.overdueInvoices, amount: fmt.money(d.finance.overdueCents, { whole: true }), outstanding: fmt.money(d.finance.outstandingCents, { whole: true }) }));
  };
  await logActivity({ sessionKey: ctx.sessionKey, actorId: ctx.user.id, mode: "system", eventType: "briefing_prepared", state: "completed", summary: `Compass answered a Weekly Briefing question (${intent.kind}) from the saved briefing. Nothing was changed or sent.` });

  switch (intent.kind) {
    case "prepare":
    case "last_week": {
      if (intent.kind === "last_week") say(ctx, t("briefing.compass.lastWeek", { period }));
      headline();
      const items = [
        ...(d ? [sectionSays("comms", d, t, fmt, days), sectionSays("lessons", d, t, fmt, days)].filter((x): x is string => Boolean(x)) : []),
        ...recLines(view.recommendations.slice(0, 3)),
      ];
      ctx.blocks.push({ kind: "found", items, links: [page, { label: t("briefing.compass.openRecs"), href: `${PAGE}#recommendations` }] });
      say(ctx, t("briefing.compass.followHint"));
      return view.overall === "action_required" ? "neutral" : "success";
    }
    case "problems": {
      const list = view.recommendations.filter((r) => r.kind !== "all_clear");
      if (!list.length) {
        say(ctx, t("briefing.compass.noProblems"));
        ctx.blocks.push({ kind: "found", items: [], links: [page] });
        return "success";
      }
      say(ctx, t("briefing.compass.problems"));
      ctx.blocks.push({ kind: "found", items: list.map((r) => `${t(`briefing.priority.${r.priority}`)}: ${recTitle(r, t, fmt)}. ${recWhy(r, t, fmt)}`), links: [page, ...list.slice(0, 2).map(recLink)] });
      say(ctx, t("briefing.compass.followHint"));
      return "neutral";
    }
    case "overdue":
    case "finance": {
      if (view.financeHidden) {
        say(ctx, t("briefing.compass.financeHidden"));
        return "clarify";
      }
      if (!d?.finance) {
        say(ctx, t("briefing.compass.financeMissing"));
        return "neutral";
      }
      const f = d.finance;
      if (!f.families.length) {
        say(ctx, t("briefing.compass.noOverdue"));
        return "success";
      }
      say(ctx, t("briefing.compass.overdueIntro", { count: f.families.length, eligible: f.eligibleFamilies }));
      const says = sectionSays("finance", d, t, fmt, days);
      if (says) say(ctx, says);
      ctx.blocks.push({
        kind: "found",
        items: f.families.map((x) => evidenceLine({ source: "xero", kind: "family", ref: x.invoices.map((i) => i.id).join(", "), name: x.name, cents: x.cents, days: x.maxDays, text: x.state }, t, fmt)),
        links: [{ label: t("briefing.compass.openPayments"), href: "/payments?tab=recovery" }, page],
        note: t("briefing.actions.approvalNote"),
      });
      return "neutral";
    }
    case "comms": {
      if (!d?.comms) {
        say(ctx, t("briefing.compass.commsMissing"));
        return "neutral";
      }
      say(ctx, sectionSays("comms", d, t, fmt, days) ?? "");
      ctx.blocks.push({
        kind: "found",
        items: d.comms.open.map((c) => evidenceLine({ source: c.channel === "sms" ? "sms" : "gmail", kind: "message", ref: c.id, name: c.contactName, hours: c.ageHours, text: c.subject }, t, fmt)),
        links: [page, { label: t("briefing.actions.openRequests"), href: "/requests" }],
      });
      return "neutral";
    }
    case "lessons": {
      if (!d) break;
      say(ctx, sectionSays("lessons", d, t, fmt, days) ?? "");
      const l = d.lessons;
      ctx.blocks.push({
        kind: "found",
        items: [
          ...l.absences.map((a) => t("briefing.lessons.away", { name: a.tutorName, start: a.startsOn, end: a.endsOn })),
          ...l.needCover.map((x) => evidenceLine({ source: "compass", kind: "lesson", ref: x.id, name: x.tutorName, at: x.startsAt, text: [x.subject, x.student].filter(Boolean).join(", ") }, t, fmt)),
          `${t("briefing.lessons.pendingChanges")}: ${l.pendingChanges}`,
          `${t("briefing.lessons.upcoming")}: ${l.upcoming}`,
        ],
        links: [page, { label: t("briefing.actions.openSchedule"), href: "/schedule" }],
      });
      return "neutral";
    }
    case "completed": {
      if (!d) break;
      const c = d.completed;
      say(ctx, t("briefing.compass.completedIntro", { count: c.total }));
      ctx.blocks.push({
        kind: "found",
        items: [
          `${t("briefing.completed.who.rules")}: ${c.byWho.rules}`,
          `${t("briefing.completed.who.admin")}: ${c.byWho.admin}`,
          `${t("briefing.completed.who.owner")}: ${c.byWho.owner}`,
          `${t("briefing.completed.who.compass")}: ${c.byWho.compass}`,
          `${t("briefing.completed.requestsProcessed")}: ${c.requestsReceived}`,
          `${t("briefing.completed.availability")}: ${c.availabilityChecks}`,
          `${t("briefing.completed.drafted")}: ${c.drafted} (${t("briefing.completed.draftedNote")})`,
        ],
        links: [page],
        note: t("briefing.completed.compassNote"),
      });
      return "success";
    }
    case "compare": {
      if (!d) break;
      say(ctx, t("briefing.compass.compareIntro"));
      ctx.blocks.push({ kind: "found", items: d.comparisons.map((c) => compareSentence(c, t, fmt)), links: [{ label: t("briefing.compare.heading"), href: PAGE }] });
      return "neutral";
    }
    case "why":
    case "first": {
      const r = topRec(view);
      if (!r) break;
      if (intent.kind === "first") say(ctx, t("briefing.compass.first", { title: recTitle(r, t, fmt), next: recNext(r, t, fmt) }));
      else say(ctx, t("briefing.compass.why", { title: recTitle(r, t, fmt) }));
      ctx.blocks.push({
        kind: "found",
        items: [recWhy(r, t, fmt), t(`briefing.rec.${r.kind}.explain` as Parameters<typeof t>[0], Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, typeof v === "number" && /Cents$/.test(k) ? fmt.money(v, { whole: true }) : v]))), ...r.evidence.slice(0, 6).map((e) => evidenceLine(e, t, fmt))],
        links: [recLink(r), page],
      });
      return "neutral";
    }
  }
  headline();
  ctx.blocks.push({ kind: "found", items: [], links: [page] });
  return "neutral";
}
