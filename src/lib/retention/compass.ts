import "server-only";
import type { TurnCtx } from "@/lib/assistant/owner";
import type { Mood } from "@/lib/assistant/logic";
import { logActivity } from "@/lib/agent/activity";
import { sydneyToday } from "@/lib/workflows/dates";
import { assessAll, firstName, outcomes, overviewCounts, shortDay, stageOf, STAGE_LABEL, sydneyDay } from "./logic";
import { findStudent, type RetentionIntent } from "./intents";
import { prepareDrafts, readRecords, retentionMode } from "./server";

// The Student Retention Agent inside Compass. It reads the same records and follows the
// same permission rules as the agent on the Insights page, and it links straight to the
// student or draft there. Nothing here goes to the AI service.

const link = (params: Record<string, string>) => `/insights?${new URLSearchParams({ retention: "open", ...params }).toString()}#retention`;
const say = (ctx: TurnCtx, text: string) => ctx.blocks.push({ kind: "text", text });

export async function retentionTurn(ctx: TurnCtx, intent: RetentionIntent, text: string): Promise<Mood> {
  const mode = retentionMode();
  let r: Awaited<ReturnType<typeof readRecords>>;
  try {
    r = await readRecords(mode);
  } catch {
    ctx.steps.push({ label: "Reading the retention records", state: "failed" });
    ctx.blocks.push({ kind: "notice", tone: "error", text: "I couldn't read the Student Retention records just now, so I haven't changed anything. If this is a new database, run the Student Retention SQL first." });
    return "error";
  }
  const now = new Date();
  const today = sydneyToday(now);
  const list = assessAll({ ...r, today });
  ctx.steps.push({ label: "Read attendance, cancellations and parent concerns", state: "done" });
  ctx.modeNote = mode === "demo" ? "From the fictional demo records. Nothing here was sent to an AI service." : "From the lesson records. Nothing here was sent to an AI service.";
  const demoNote = mode === "demo" ? "Fictional demo data." : undefined;
  const flagged = list.filter((a) => a.flagged);

  switch (intent.kind) {
    case "at_risk": {
      const o = overviewCounts(list, r.messages, r.settings, now);
      if (!flagged.length) {
        say(ctx, `None of the ${o.monitored} students I monitor shows a pattern of disengagement right now.`);
        ctx.blocks.push({ kind: "found", items: [], links: [{ label: "Open Student Retention Agent", href: link({}) }], note: demoNote });
        return "success";
      }
      say(ctx, `${o.flagged} of ${o.monitored} students have retention flags: ${o.high} high and ${o.medium} medium. These are prompts to check in, not predictions.`);
      ctx.blocks.push({
        kind: "found",
        items: flagged.map((a) => `${a.name} (${a.level === "high" ? "High" : "Medium"}, ${a.score}): ${a.reasons.slice(0, 2).join("; ")}`),
        links: [{ label: "Review Students", href: link({ tab: "students" }) }, ...flagged.slice(0, 3).map((a) => ({ label: `Open ${firstName(a.name)}`, href: link({ tab: "students", student: a.studentId }) }))],
        note: demoNote,
      });
      return "neutral";
    }
    case "why": {
      const a = findStudent(text, list, r.contacts);
      if (!a) {
        say(ctx, `I couldn't tell which student you mean. ${flagged.length ? `Flagged at the moment: ${flagged.map((x) => x.name).join(", ")}.` : "No students are flagged at the moment."}`);
        return "clarify";
      }
      say(ctx, a.level === "low" ? `${a.name} isn't flagged. ${a.reasons[0]}.` : `${a.name} is ${a.level === "high" ? "high" : "medium"} risk with a score of ${a.score}${a.dismissed ? ", but you dismissed the flag" : ""}. Here's what I found in the records.`);
      ctx.blocks.push({
        kind: "found",
        items: [...a.factors.map((f) => `${f.text} (${f.points} points)`), `Suggested action: ${a.suggestedAction}`],
        links: [{ label: `Open ${firstName(a.name)}'s Findings`, href: link({ tab: "students", student: a.studentId }) }],
        note: "Based only on lesson records and parent concerns. It isn't a prediction that the student will leave.",
      });
      return "neutral";
    }
    case "cancellations": {
      const hits = list.filter((a) => a.cancellations + a.noShows >= 2).sort((x, y) => y.cancellations + y.noShows - (x.cancellations + x.noShows));
      if (!hits.length) {
        say(ctx, `No student has two or more cancelled or missed lessons in the last ${r.settings.windowDays} days.`);
        return "success";
      }
      say(ctx, `${hits.length} student${hits.length === 1 ? " has" : "s have"} repeated cancellations or missed lessons in the last ${r.settings.windowDays} days. Tutor cancellations aren't counted.`);
      ctx.blocks.push({ kind: "found", items: hits.map((a) => `${a.name}: ${a.cancellations} cancelled by the family, ${a.noShows} missed`), links: hits.slice(0, 3).map((a) => ({ label: `Open ${firstName(a.name)}`, href: link({ tab: "students", student: a.studentId }) })), note: demoNote });
      return "neutral";
    }
    case "prepare": {
      const a = findStudent(text, list, r.contacts);
      if (!a) {
        const asked = /\b([A-Z][a-z]+)'s\b/.exec(text)?.[1] ?? /\bfor ([A-Z][a-z]+)\b/.exec(text)?.[1];
        if (asked && asked !== "Compass") say(ctx, `I couldn't find a student called ${asked} in the monitored records.`);
        say(ctx, `Which student is the check-in for? ${flagged.length ? `Flagged at the moment: ${flagged.map((x) => x.name).join(", ")}.` : ""}`.trim());
        return "clarify";
      }
      const res = await prepareDrafts(ctx.user, [a.studentId]);
      await logActivity({ sessionKey: ctx.sessionKey, actorId: ctx.user.id, mode: "system", eventType: "draft_prepared", state: "completed", summary: `Compass prepared a retention check-in for ${a.name}'s family. Nothing was sent.` });
      say(ctx, res.prepared
        ? `I've prepared a personalised check-in for ${a.contact?.name ?? "the family"}. Nothing has been sent. ${ctx.user.role === "owner" ? "Review it, edit anything you like and approve it before choosing how to send." : "The owner needs to approve it before it can be sent."}`
        : res.existing ? `${firstName(a.name)} already has a check-in in progress, so I kept that one.` : `I couldn't prepare a check-in: ${res.skipped[0]?.reason ?? "no parent contact on file"}.`);
      const go = res.prepared || res.existing ? { label: "Open the Draft", href: link({ prepare: a.studentId }) } : { label: `Open ${firstName(a.name)}`, href: link({ tab: "students", student: a.studentId }) };
      ctx.blocks.push({ kind: "found", items: [], links: [go], note: demoNote });
      return res.prepared || res.existing ? "success" : "clarify";
    }
    case "no_reply": {
      const waiting = r.messages.filter((m) => m.status === "sent" && m.responseStatus === "none" && m.followUp !== "resolved");
      const names = new Map(r.students.map((s) => [s.id, s.name]));
      if (!waiting.length) {
        say(ctx, "Every family that received a check-in has replied or been marked resolved.");
        return "success";
      }
      say(ctx, `${waiting.length} famil${waiting.length === 1 ? "y hasn't" : "ies haven't"} replied to a check-in yet.`);
      ctx.blocks.push({ kind: "found", items: waiting.map((m) => `${m.recipientName} (${names.get(m.studentId) ?? m.studentId}): ${m.channel === "sms" ? "SMS" : "email"} on ${m.sentAt ? shortDay(sydneyDay(m.sentAt)) : "an unknown date"}, ${STAGE_LABEL[stageOf(m, today)]}`), links: [{ label: "Open Tracking and Outcomes", href: link({ tab: "tracking" }) }], note: demoNote });
      return "neutral";
    }
    case "outcomes": {
      const o = outcomes({ days: 30, messages: r.messages, lessons: r.lessons, students: r.students, today });
      if (!o.checkIns) {
        say(ctx, "No retention check-ins have been sent yet, so there are no outcomes to show.");
        return "neutral";
      }
      say(ctx, `Here's what happened in the 30 days after each of the ${o.checkIns} recent check-ins. This shows what followed, not what caused it.`);
      ctx.blocks.push({
        kind: "found",
        items: [
          `Parents replied: ${o.responded} of ${o.checkIns}`,
          `Still enrolled: ${o.continued}. Discontinued: ${o.discontinued}`,
          `Cases resolved: ${o.resolved}`,
          o.averageChange === null ? "Not enough lessons yet to compare attendance" : `Average attendance change: ${o.averageChange > 0 ? "+" : ""}${o.averageChange} points across ${o.compared} check-in${o.compared === 1 ? "" : "s"}`,
          ...o.rows.map((x) => `${x.name}: ${x.before ?? "–"}% before, ${x.after ?? "–"}% after${x.complete ? "" : ` (${x.daysSoFar} days so far)`}`),
        ],
        links: [{ label: "Open Tracking and Outcomes", href: link({ tab: "tracking" }) }],
        note: demoNote,
      });
      return "neutral";
    }
  }
}
