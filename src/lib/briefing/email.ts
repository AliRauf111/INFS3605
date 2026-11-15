import type { Translate } from "@/lib/i18n/core";
import type { Format } from "@/lib/i18n/format";
import type { BriefingView, SectionId } from "./types";
import { compareSentence, periodLabel, recNext, recTitle, recWhy, sectionSays } from "./text";

// The weekly briefing email: an HTML version in the Tutor Compass look, and a plain-text
// version for mail apps that don't show HTML. Every value is escaped. The link opens the
// full briefing in Tutor Compass, which asks the reader to sign in, so the email itself
// never carries anything beyond this summary.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const COLOUR = { red: "#b3263e", amber: "#8a5a00", green: "#15803d" } as const;
const SOFT = { red: "#fcebee", amber: "#fdf3dc", green: "#e8f6ec" } as const;

export type BriefingEmail = { subject: string; html: string; text: string };

export function briefingEmail(b: BriefingView, opts: { t: Translate; fmt: Format; link: string; sections: SectionId[]; businessName: string; demo: boolean }): BriefingEmail {
  const { t, fmt, link, sections, businessName, demo } = opts;
  const has = (s: SectionId) => sections.includes(s);
  const period = periodLabel(b.period, t, fmt);
  const subject = `${businessName}: ${t("briefing.title")} (${period})${demo ? " [demo]" : ""}`;
  const d = b.detail;
  const text: string[] = [t("briefing.title"), period, `${t("briefing.statusLabel")}: ${t(`briefing.overall.${b.overall}`)}`, ""];
  const blocks: string[] = [];

  const row = (label: string, value: string) =>
    `<td style="padding:14px 16px;background:#f6f1fe;border-radius:14px;width:33%"><div style="font-size:12px;color:#6b6478">${esc(label)}</div><div style="font-size:22px;font-weight:700;color:#272b40;margin-top:4px">${esc(value)}</div></td>`;
  const heading = (s: string) => `<h2 style="font-size:17px;color:#272b40;margin:26px 0 10px">${esc(s)}</h2>`;
  const para = (s: string) => `<p style="font-size:14px;line-height:1.6;color:#4b4358;margin:0 0 10px">${esc(s)}</p>`;

  if (has("summary")) {
    const cells = [
      [t("briefing.metric.activeStudents"), fmt.number(b.headline.activeStudents)],
      [t("briefing.metric.upcomingLessons"), fmt.number(b.headline.upcomingLessons)],
      [t("briefing.metric.tasksCompleted"), fmt.number(b.headline.tasksCompleted)],
    ];
    blocks.push(heading(t("briefing.compare.heading")));
    blocks.push(`<table role="presentation" width="100%" cellspacing="8" style="border-collapse:separate"><tr>${cells.map(([l, v]) => row(l, v)).join("")}</tr></table>`);
    for (const c of (d?.comparisons ?? []).slice(0, 4)) {
      blocks.push(para(compareSentence(c, t, fmt)));
      text.push(compareSentence(c, t, fmt));
    }
    cells.forEach(([l, v]) => text.push(`${l}: ${v}`));
  }

  if (has("finance") && d?.finance && !b.financeHidden) {
    const f = d.finance;
    blocks.push(heading(t("briefing.finance.heading")));
    blocks.push(`<table role="presentation" width="100%" cellspacing="8" style="border-collapse:separate"><tr>${row(t("briefing.finance.outstanding"), fmt.money(f.outstandingCents, { whole: true }))}${row(t("briefing.finance.overdue"), fmt.number(f.overdueInvoices))}${row(t("briefing.finance.overdueBalance"), fmt.money(f.overdueCents, { whole: true }))}</tr></table>`);
    const says = sectionSays("finance", d, t, fmt, b.recommendations.find((r) => r.kind === "overdue")?.params.days as number ?? 14);
    if (says) blocks.push(para(says));
    text.push("", t("briefing.finance.heading"), `${t("briefing.finance.outstanding")}: ${fmt.money(f.outstandingCents, { whole: true })}`, `${t("briefing.finance.overdue")}: ${f.overdueInvoices} (${fmt.money(f.overdueCents, { whole: true })})`);
  }

  if (has("communications") && d?.comms) {
    blocks.push(heading(t("briefing.comms.heading")));
    const says = sectionSays("comms", d, t, fmt, 0);
    if (says) blocks.push(para(says));
    const items = d.comms.open.slice(0, 5).map((c) => `<li style="margin:0 0 6px">${esc(c.contactName)}: ${esc(c.subject)} <span style="color:#6b6478">(${esc(t("briefing.comms.waited", { hours: c.ageHours }))})</span></li>`);
    if (items.length) blocks.push(`<ul style="font-size:14px;color:#4b4358;padding-left:20px;margin:0">${items.join("")}</ul>`);
    text.push("", t("briefing.comms.heading"), says ?? "");
  }

  if (has("lessons") && d) {
    blocks.push(heading(t("briefing.lessons.heading")));
    const says = sectionSays("lessons", d, t, fmt, 0);
    if (says) blocks.push(para(says));
    text.push("", t("briefing.lessons.heading"), says ?? "");
  }

  if (has("completed") && d) {
    const c = d.completed;
    blocks.push(heading(t("briefing.completed.heading")));
    const lines = [
      `${t("briefing.completed.who.rules")}: ${c.byWho.rules}`,
      `${t("briefing.completed.who.admin")}: ${c.byWho.admin}`,
      `${t("briefing.completed.who.owner")}: ${c.byWho.owner}`,
      `${t("briefing.completed.who.compass")}: ${c.byWho.compass}`,
    ];
    blocks.push(para(t("briefing.completed.total", { count: c.total })));
    blocks.push(`<ul style="font-size:14px;color:#4b4358;padding-left:20px;margin:0">${lines.map((l) => `<li style="margin:0 0 4px">${esc(l)}</li>`).join("")}</ul>`);
    text.push("", t("briefing.completed.heading"), t("briefing.completed.total", { count: c.total }), ...lines);
  }

  if (has("recommendations")) {
    blocks.push(heading(t("briefing.recs.heading")));
    text.push("", t("briefing.recs.heading"));
    b.recommendations.slice(0, 3).forEach((r, i) => {
      const title = recTitle(r, t, fmt);
      blocks.push(
        `<div style="border-left:4px solid ${COLOUR[r.priority]};background:${SOFT[r.priority]};border-radius:12px;padding:12px 14px;margin:0 0 10px">` +
          `<div style="font-size:12px;font-weight:700;color:${COLOUR[r.priority]}">${esc(t(`briefing.priority.${r.priority}`))}</div>` +
          `<div style="font-size:15px;font-weight:700;color:#272b40;margin:4px 0">${i + 1}. ${esc(title)}</div>` +
          `<div style="font-size:13px;color:#4b4358;line-height:1.5">${esc(recWhy(r, t, fmt))} ${esc(recNext(r, t, fmt))}</div></div>`,
      );
      text.push(`${i + 1}. ${title} (${t(`briefing.priority.${r.priority}`)}). ${recNext(r, t, fmt)}`);
    });
  }

  const demoNote = demo ? `<p style="font-size:12px;color:#8a5a00;background:#fdf3dc;border-radius:10px;padding:10px 12px;margin:0 0 16px">${esc(t("briefing.demoNote"))}</p>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f0eafd;font-family:Inter,-apple-system,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" style="background:#f0eafd"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:620px;background:#ffffff;border-radius:22px;border:1px solid #e4dcf4"><tr><td style="padding:28px 26px">
<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6a42c2">${esc(businessName)} · ${esc(t("briefing.eyebrow"))}</div>
<h1 style="font-size:24px;color:#272b40;margin:8px 0 4px">${esc(t("briefing.title"))}</h1>
<p style="font-size:14px;color:#6b6478;margin:0 0 6px">${esc(period)}</p>
<p style="display:inline-block;font-size:13px;font-weight:700;color:${COLOUR[b.overall === "action_required" ? "red" : b.overall === "attention" ? "amber" : "green"]};background:${SOFT[b.overall === "action_required" ? "red" : b.overall === "attention" ? "amber" : "green"]};border-radius:20px;padding:6px 12px;margin:6px 0 18px">${esc(t(`briefing.overall.${b.overall}`))}</p>
${demoNote}${blocks.join("\n")}
<p style="margin:26px 0 8px"><a href="${esc(link)}" style="display:inline-block;background:#6a42c2;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:24px">${esc(t("briefing.card.view"))}</a></p>
<p style="font-size:12px;color:#6b6478;line-height:1.5;margin:14px 0 0">${esc(t("briefing.aiNote"))}</p>
</td></tr></table></td></tr></table></body></html>`;
  text.push("", `${t("briefing.card.view")}: ${link}`);
  return { subject, html, text: text.join("\n") };
}
