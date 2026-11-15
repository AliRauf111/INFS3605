import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  alertKeyFor,
  assessAll,
  assessStudent,
  dismissalHolds,
  draftCheckIn,
  internalWording,
  outcomes,
  overviewCounts,
  soundsBlaming,
  stageOf,
  summaryText,
  sydneyDay,
  validateSettings,
} from "@/lib/retention/logic";
import { demoMessages, demoRecords, demoSql, spread } from "@/lib/retention/demo-data";
import { detectRetention, findStudent } from "@/lib/retention/intents";
import type { RetentionContact, RetentionMessage, RetentionStudent } from "@/lib/retention/types";

const TODAY = "2026-11-05";
const NAMES: Record<string, [string, string]> = {
  "ST-01": ["Aarav Mehta", "BC-01"], "ST-02": ["Anika Mehta", "BC-01"], "ST-03": ["Liam O'Brien", "BC-02"], "ST-04": ["Chloe Wong", "BC-03"], "ST-05": ["Omar Hassan", "BC-04"],
  "ST-06": ["Oliver Chen", "BC-05"], "ST-07": ["Jack Nguyen", "BC-06"], "ST-08": ["Ethan Brown", "BC-07"], "ST-09": ["Mia Brown", "BC-07"], "ST-10": ["Noah Smith", "BC-08"],
};
const students: RetentionStudent[] = Object.entries(NAMES).map(([id, [name, contactId]]) => ({ id, name, yearLevel: 9, enrolled: id !== "ST-10", contactId }));
const contacts: RetentionContact[] = [
  { id: "BC-01", name: "Priya Mehta", email: "priya.mehta@example.com", phone: "+61 412 555 101", emailPermitted: true, smsPermitted: true },
  { id: "BC-06", name: "Tom Nguyen", email: "tom.nguyen@example.com", phone: "+61 412 555 106", emailPermitted: true, smsPermitted: false },
];
const records = demoRecords(TODAY);
const all = () => assessAll({ students, contacts, ...records, settings: DEFAULT_SETTINGS, today: TODAY, dismissals: [] });
const byId = (id: string) => all().find((a) => a.studentId === id)!;

function msg(over: Partial<RetentionMessage>): RetentionMessage {
  return {
    id: "m1", studentId: "ST-01", contactId: "BC-01", channel: "email", recipientName: "Priya Mehta", address: "priya.mehta@example.com", subject: "Hi", body: "Hello",
    source: "template", variant: 0, status: "draft", version: 1, preparedBy: null, approvedBy: null, approvedAt: null, rejectedReason: null, sentBy: null, sentAt: null,
    deliveryStatus: "none", deliveryDetail: null, responseStatus: "none", responseAt: null, responseNote: null, followUp: "none", followUpOn: null, mode: "demo",
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...over,
  };
}

describe("risk assessment", () => {
  it("flags the two high-risk and two medium-risk demo students and leaves the rest clear", () => {
    const list = all();
    expect(list.filter((a) => a.level === "high").map((a) => a.name)).toEqual(["Aarav Mehta", "Jack Nguyen"]);
    expect(list.filter((a) => a.level === "medium").map((a) => a.name)).toEqual(["Omar Hassan", "Chloe Wong"]);
    expect(list.filter((a) => a.level === "low")).toHaveLength(5);
  });

  it("explains Aarav's score from the records: four cancellations, 91% to 58%, two open concerns", () => {
    const a = byId("ST-01");
    expect(a.previousAttendance).toBe(91);
    expect(a.currentAttendance).toBe(58);
    expect(a.cancellations).toBe(4);
    expect(a.openConcerns).toHaveLength(2);
    expect(a.score).toBe(a.factors.reduce((s, f) => s + f.points, 0));
    expect(a.factors.map((f) => f.text)).toContain("Attendance fell from 91% to 58%");
    expect(a.suggestedAction).toMatch(/scheduling, tutor suitability or learning support/);
    expect(a.contact?.name).toBe("Priya Mehta");
  });

  it("never counts tutor cancellations or confidential notes against a family", () => {
    const mia = byId("ST-09");
    expect(mia.score).toBe(0);
    const omar = byId("ST-05");
    expect(omar.confidentialNotes).toBe(1);
    expect(omar.openConcerns.every((c) => !c.confidential)).toBe(true);
    expect(omar.factors.find((f) => f.id === "open_concerns")?.points).toBe(10);
  });

  it("doesn't monitor former students", () => {
    expect(all().some((a) => a.studentId === "ST-10")).toBe(false);
  });

  it("uses the owner's thresholds instead of fixed ones", () => {
    const strict = assessAll({ students, contacts, ...records, settings: { ...DEFAULT_SETTINGS, highThreshold: 90, mediumThreshold: 50 }, today: TODAY, dismissals: [] });
    expect(strict.filter((a) => a.level === "high")).toHaveLength(0);
    expect(strict.filter((a) => a.level === "medium").map((a) => a.name)).toEqual(["Aarav Mehta", "Jack Nguyen"]);
  });

  it("says when there aren't enough lessons to compare", () => {
    const a = assessStudent({ student: { id: "X", name: "New Student", yearLevel: 7, enrolled: true, contactId: "C" }, contact: null, lessons: [], concerns: [], settings: DEFAULT_SETTINGS, today: TODAY });
    expect(a.score).toBe(0);
    expect(a.reasons[0]).toMatch(/Not enough lesson records/);
  });

  it("keeps a dismissal only until the records get worse", () => {
    const d = { studentId: "ST-05", reason: "Family on holiday", scoreAt: 48, levelAt: "medium" as const, createdAt: "", by: null };
    expect(dismissalHolds(d, 48, "medium")).toBe(true);
    expect(dismissalHolds(d, 57, "medium")).toBe(true);
    expect(dismissalHolds(d, 58, "medium")).toBe(false);
    expect(dismissalHolds(d, 61, "high")).toBe(false);
    const list = assessAll({ students, contacts, ...records, settings: DEFAULT_SETTINGS, today: TODAY, dismissals: [d] });
    const omar = list.find((a) => a.studentId === "ST-05")!;
    expect(omar.flagged).toBe(false);
    expect(omar.dismissed?.reason).toBe("Family on holiday");
  });

  it("counts students needing the owner, leaving out ones with a check-in under way or sent recently", () => {
    const list = all();
    const now = new Date(`${TODAY}T03:00:00Z`);
    expect(overviewCounts(list, [], DEFAULT_SETTINGS, now)).toMatchObject({ monitored: 9, high: 2, medium: 2, low: 5, flagged: 4, ownerReview: 2 });
    expect(overviewCounts(list, [msg({ status: "approved" })], DEFAULT_SETTINGS, now).ownerReview).toBe(1);
    expect(overviewCounts(list, [msg({ status: "sent", sentAt: "2026-11-01T00:00:00Z" })], DEFAULT_SETTINGS, now).ownerReview).toBe(1);
    expect(overviewCounts(list, [msg({ status: "sent", sentAt: "2026-09-01T00:00:00Z" })], DEFAULT_SETTINGS, now).ownerReview).toBe(2);
    expect(summaryText(list, overviewCounts(list, [], DEFAULT_SETTINGS, now))).toMatch(/not predictions/);
  });

  it("keys the attention alert by the high-risk students, in any order", () => {
    expect(alertKeyFor(["ST-07", "ST-01"])).toBe(alertKeyFor(["ST-01", "ST-07"]));
    expect(alertKeyFor(["ST-01"])).not.toBe(alertKeyFor(["ST-01", "ST-07"]));
  });

  it("checks threshold changes", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, mediumThreshold: 70 })).toMatch(/lower than/);
    expect(validateSettings({ ...DEFAULT_SETTINGS, windowDays: 3 })).toMatch(/7 and 90/);
  });
});

describe("check-in drafts", () => {
  const base = { parentName: "Priya Mehta", studentName: "Aarav Mehta", subject: "Year 9 Mathematics", tutorName: "Priya Shah", business: "Tutor Compass", signoff: "Alex Chen", topics: ["scheduling" as const], variant: 0 };

  it("uses the tutor's full name when the parent has the same first name", () => {
    const d = draftCheckIn({ ...base, channel: "email" });
    expect(d.body).toMatch(/catch-up with Priya Shah/);
    expect(draftCheckIn({ ...base, tutorName: "Tom Becker", channel: "email" }).body).toMatch(/catch-up with Tom /);
  });

  it("writes a personalised email with a subject, greeting, offer of help, next step and closing", () => {
    const d = draftCheckIn({ ...base, channel: "email" });
    expect(d.subject).toMatch(/Aarav/);
    expect(d.body).toMatch(/^Hi Priya,/);
    expect(d.body).toMatch(/Mathematics/);
    expect(d.body).toMatch(/happy to help|glad to arrange|sort that out/);
    expect(d.body).toMatch(/reply/i);
    expect(d.body).toMatch(/Kind regards,\nAlex Chen\nTutor Compass$/);
  });

  it("keeps SMS short and gives a new wording on regenerate", () => {
    const texts = [0, 1, 2].map((variant) => draftCheckIn({ ...base, channel: "sms", variant }).body);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(320);
    expect(new Set(texts).size).toBe(3);
  });

  it("never shares scores, attendance or concerns, and never sounds like blame", () => {
    for (const channel of ["email", "sms"] as const) {
      for (const variant of [0, 1, 2]) {
        for (const topics of [[], ["tutor_fit"], ["progress"], ["cost"], ["communication"]] as const) {
          const d = draftCheckIn({ ...base, channel, variant, topics: [...topics] });
          expect(internalWording(`${d.subject ?? ""} ${d.body}`)).toEqual([]);
          expect(soundsBlaming(d.body)).toBe(false);
          expect(d.body).not.toMatch(/soccer|homework|confidence|cancel|missed|attendance/i);
        }
      }
    }
  });

  it("spots internal wording an owner might type", () => {
    expect(internalWording("Aarav's risk score is 85")).toEqual(["risk", "score"]);
    expect(internalWording("Attendance is 58%")).toEqual(["a percentage"]);
    expect(internalWording("He was flagged by Compass AI")).toEqual(["flagged", "internal tools"]);
    expect(soundsBlaming("You missed three lessons")).toBe(true);
  });
});

describe("tracking", () => {
  it("only shows Delivered when the provider confirmed it, and Sent (Simulated) in demo mode", () => {
    expect(stageOf(msg({ status: "sent", deliveryStatus: "simulated", followUp: "scheduled", followUpOn: "2026-11-09" }), TODAY)).toBe("simulated");
    expect(stageOf(msg({ status: "sent", deliveryStatus: "accepted", followUp: "scheduled", followUpOn: "2026-11-09" }), TODAY)).toBe("sent");
    expect(stageOf(msg({ status: "sent", deliveryStatus: "delivered", followUp: "scheduled", followUpOn: "2026-11-09" }), TODAY)).toBe("delivered");
    expect(stageOf(msg({ status: "failed", deliveryStatus: "failed" }), TODAY)).toBe("delivery_failed");
  });

  it("moves through the follow-up labels", () => {
    expect(stageOf(msg({ status: "draft" }), TODAY)).toBe("draft_prepared");
    expect(stageOf(msg({ status: "awaiting_approval" }), TODAY)).toBe("awaiting_owner_approval");
    expect(stageOf(msg({ status: "approved" }), TODAY)).toBe("ready_to_send");
    expect(stageOf(msg({ status: "sent", deliveryStatus: "simulated", followUp: "scheduled", followUpOn: "2026-11-01" }), TODAY)).toBe("follow_up_required");
    expect(stageOf(msg({ status: "sent", deliveryStatus: "simulated", responseStatus: "received" }), TODAY)).toBe("response_received");
    expect(stageOf(msg({ status: "sent", deliveryStatus: "simulated", responseStatus: "received", followUp: "resolved" }), TODAY)).toBe("resolved");
  });

  it("compares attendance before and after each check-in over 14 and 30 days", () => {
    const sent = demoMessages().map((m, i) => msg({
      id: `m${i}`, studentId: m.studentId, status: "sent", deliveryStatus: "simulated", sentAt: new Date(Date.parse(`${TODAY}T00:00:00Z`) - m.daysAgo * 86_400_000).toISOString(),
      responseStatus: m.responseDaysAgo === null ? "none" : "received", followUp: m.followUp,
    }));
    const d30 = outcomes({ days: 30, messages: sent, lessons: records.lessons, students, today: TODAY });
    expect(d30.checkIns).toBe(2);
    expect(d30.responseRate).toBe(50);
    expect(d30.resolved).toBe(1);
    expect(d30.continued).toBe(2);
    const liam = d30.rows.find((r) => r.studentId === "ST-03")!;
    expect(liam.before).toBe(63);
    expect(liam.after).toBe(100);
    expect(liam.complete).toBe(false);
    const d14 = outcomes({ days: 14, messages: sent, lessons: records.lessons, students, today: TODAY });
    expect(d14.rows.find((r) => r.studentId === "ST-03")!.complete).toBe(true);
    // Drafts and unsent messages never count as outreach.
    expect(outcomes({ days: 30, messages: [msg({ status: "approved" })], lessons: records.lessons, students, today: TODAY }).checkIns).toBe(0);
  });
});

describe("Compass questions", () => {
  it("recognises the retention questions from the brief", () => {
    expect(detectRetention("Which students are at risk of leaving?")?.kind).toBe("at_risk");
    expect(detectRetention("Why has Aarav been flagged?")?.kind).toBe("why");
    expect(detectRetention("Show students with repeated cancellations.")?.kind).toBe("cancellations");
    expect(detectRetention("Prepare a check-in for Sophie's parent.")?.kind).toBe("prepare");
    expect(detectRetention("Which parents have not responded?")?.kind).toBe("no_reply");
    expect(detectRetention("Show the outcome of recent retention check-ins.")?.kind).toBe("outcomes");
  });

  it("leaves ordinary requests alone", () => {
    for (const text of ["What needs my attention?", "Refund $75 for BK-1046", "Why was BK-1042 escalated?", "Prepare a reply for the family", "Move Leo's lesson to Thursday"]) {
      expect(detectRetention(text)).toBeNull();
    }
  });

  it("finds the student by name, first name or parent", () => {
    const list = all();
    expect(findStudent("Why has Aarav been flagged?", list, contacts)?.studentId).toBe("ST-01");
    expect(findStudent("prepare a check-in for jack nguyen", list, contacts)?.studentId).toBe("ST-07");
    expect(findStudent("Prepare a check-in for Sophie's parent", list, contacts)).toBeNull();
  });
});

describe("demo data", () => {
  it("spreads lessons evenly and the SQL seed matches the plan", () => {
    expect(spread(1, 30, 12)[0]).toBe(1);
    expect(spread(1, 30, 12).at(-1)).toBe(30);
    const sql = demoSql();
    expect(sql).toContain("create or replace function public.reset_retention_demo()");
    expect(sql).toContain("where data_label = 'fictional_demo'");
    expect(sql).not.toMatch(/delete from public\.(billing_|retention_\w+)(?![^;]*fictional_demo)/);
    expect(readFileSync("supabase/retention-demo.sql", "utf8")).toBe(sql);
  });

  it("the migration ties approval to the exact message and lets only the owner approve and send", () => {
    const m = readFileSync("supabase/migrations/20261105000002_student_retention.sql", "utf8");
    expect(m).toMatch(/approve_retention_message[\s\S]*v_role is distinct from 'owner'/);
    expect(m).toMatch(/send_retention_message[\s\S]*v_role is distinct from 'owner'/);
    expect(m).toMatch(/retention_message_hash\(v_msg\.channel, v_msg\.address, v_msg\.subject, v_msg\.body\) <> v_msg\.approved_hash/);
    expect(m).toMatch(/already been sent/);
    expect(m).toMatch(/enable row level security/);
  });
});

describe("sydneyDay", () => {
  it("counts a morning send in Sydney on the Sydney date, not the UTC one", () => {
    expect(sydneyDay("2026-10-25T23:00:00Z")).toBe("2026-10-26");
    expect(sydneyDay("2026-11-05T10:00:00Z")).toBe("2026-11-05");
  });
});
