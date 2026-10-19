import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  decisionAction,
  decisionTitle,
  emptyTask,
  filterSlots,
  looksLikePolicyQuestion,
  matchStudents,
  mergeTask,
  nextField,
  parseBareAmount,
  parseDayHint,
  parseDays,
  parsePartHint,
  parseReference,
  parseStudentHint,
  parseTri,
  searchArticles,
  taskToForm,
  topicMissing,
  type Article,
  type Extracted,
} from "@/lib/assistant/logic";
import { validateFactsForm } from "@/lib/validation/facts";

const blank: Extracted = {
  requestType: null,
  referenceId: "",
  amount: "",
  extensionDays: "",
  complaint: null,
  welfare: null,
  financialImpact: null,
  context: "",
  studentHint: "",
  dayHint: null,
  partHint: null,
};

describe("reading what the person typed", () => {
  it("finds references, amounts and days", () => {
    expect(parseReference("Refund for bk 1042 please")).toBe("BK-1042");
    expect(parseReference("FAM-07")).toBe("FAM-07");
    expect(parseReference("nothing here")).toBeNull();
    expect(parseBareAmount("$30")).toBe("30");
    expect(parseBareAmount("45.50 dollars")).toBe("45.50");
    expect(parseBareAmount("about thirty")).toBeNull();
    expect(parseDays("7")).toBe("7");
    expect(parseDays("they need 14 more days")).toBe("14");
  });

  it("reads days, parts of the day and yes or no", () => {
    expect(parseDayHint("Can we move it to Friday?")).toBe(5);
    expect(parseDayHint("no day")).toBeNull();
    expect(parsePartHint("Thursday afternoon")).toBe("afternoon");
    expect(parsePartHint("in the morning")).toBe("morning");
    expect(parseTri("Yes.")).toBe("yes");
    expect(parseTri("not sure")).toBe("unsure");
    expect(parseTri("I think the tutor was late")).toBeNull();
  });

  it("only takes real names as student hints", () => {
    expect(parseStudentHint("Can we move Leo's lesson to Friday?")).toBe("Leo");
    expect(parseStudentHint("Can Sarah's lesson move?")).toBe("");
    expect(matchStudents([{ student_name: "Ella and Noah Martin" }, { student_name: "Leo Chen" }], "Noah")).toHaveLength(1);
    expect(matchStudents([{ student_name: "Leo Chen" }], "Emma")).toHaveLength(0);
  });

  it("spots policy questions but not requests with a reference", () => {
    expect(looksLikePolicyQuestion("What is our policy on refunds?")).toBe(true);
    expect(looksLikePolicyQuestion("Refund policy for BK-1042")).toBe(false);
  });
});

describe("building the request", () => {
  it("never lowers complaint or welfare from free text", () => {
    const t = mergeTask(emptyTask(), { ...blank, complaint: "no", welfare: "no" });
    expect(t.complaint).toBeNull();
    expect(t.welfare).toBeNull();
    const raised = mergeTask(emptyTask(), { ...blank, welfare: "yes" });
    expect(raised.welfare).toBe("yes");
  });

  it("asks for things in the wizard's order", () => {
    let t = emptyTask();
    expect(nextField(t)).toBe("requestType");
    t = applyAnswer(t, "requestType", "refund");
    expect(nextField(t)).toBe("referenceId");
    t = applyAnswer(t, "referenceId", "bk-1042");
    expect(t.referenceId).toBe("BK-1042");
    expect(nextField(t)).toBe("amount");
    t = applyAnswer(t, "amount", "30");
    expect(nextField(t)).toBe("complaint");
    t = applyAnswer(t, "complaint", "no");
    t = applyAnswer(t, "welfare", "unsure");
    expect(nextField(t)).toBeNull();
  });

  it("asks about slots and fees for lesson changes", () => {
    let t = applyAnswer(applyAnswer(emptyTask(), "requestType", "lesson_change"), "referenceId", "BK-1042");
    expect(nextField(t)).toBe("proposedSlotId");
    t = applyAnswer(t, "proposedSlotId", "none");
    expect(t.slotAsked).toBe(true);
    expect(nextField(t)).toBe("financialImpact");
  });

  it("produces facts the existing validation accepts", () => {
    let t = emptyTask();
    for (const [f, v] of [["requestType", "refund"], ["referenceId", "BK-1042"], ["amount", "30"], ["complaint", "no"], ["welfare", "no"]] as const) {
      t = applyAnswer(t, f, v);
    }
    const result = validateFactsForm(taskToForm(t));
    expect(result.ok).toBe(true);
  });
});

describe("decision wording", () => {
  it("labels each colour", () => {
    expect(decisionTitle("green", false)).toBe("Within your authority");
    expect(decisionTitle("amber", false)).toBe("Owner approval required");
    expect(decisionTitle("amber", true)).toBe("More information needed");
    expect(decisionTitle("red", false)).toBe("Owner Review Required");
    expect(decisionAction("green", "refund")).toBe("Prepare refund");
    expect(decisionAction("amber", "refund")).toBe("Prepare approval request");
    expect(decisionAction("red", "lesson_change")).toBe("Prepare owner review");
  });
});

describe("slots", () => {
  const slots = [
    { startsAt: "2026-10-23T05:00:00Z", status: "free" }, // Fri 4pm Sydney
    { startsAt: "2026-10-23T22:00:00Z", status: "free" }, // Sat 9am Sydney
    { startsAt: "2026-10-23T06:00:00Z", status: "booked" },
  ];
  it("filters by Sydney day and part of day", () => {
    expect(filterSlots(slots, 5, null)).toHaveLength(1);
    expect(filterSlots(slots, null, "morning")).toHaveLength(1);
    expect(filterSlots(slots, 5, "morning")).toHaveLength(0);
  });
});

describe("searching procedures", () => {
  const articles: Article[] = [
    { id: "a1", title: "Refund procedure", category: "refund", body: "Check the payment.", owner_approved: true },
    { id: "a2", title: "Rescheduling a lesson", category: "lesson_change", body: "Offer a free slot.", owner_approved: true },
  ];
  it("ranks the matching procedure first and returns nothing for unknown topics", () => {
    expect(searchArticles(articles, "how do we handle a refund?")[0].id).toBe("a1");
    expect(searchArticles(articles, "parking at the centre")).toHaveLength(0);
  });
  it("flags a cancellation question the procedure doesn't cover", () => {
    expect(topicMissing("what about cancelling a lesson", articles[1])).toBe("cancellation");
    expect(topicMissing("moving a lesson", articles[1])).toBeNull();
  });
});
