import type { Colour, RequestStatus, Role } from "./types";

// Plain-language wording for where a request is up to. Shared by the dashboard and the
// request page so both describe the same step the same way. Nothing here decides a
// colour; it only labels what the rule engine and the workflow already recorded.

export type StepState = "done" | "current" | "upcoming" | "skipped";
export type ProgressStep = { label: string; state: StepState; note?: string };

export const STEP_LABELS = ["Submitted", "Rule check", "Owner review", "Recorded"] as const;

export function requestProgress(status: RequestStatus, ownerInvolved: boolean): ProgressStep[] {
  const ruleCheck: StepState = status === "needs_clarification" ? "current" : "done";
  let owner: ProgressStep = { label: "Owner review", state: "upcoming" };
  if (["review_required", "awaiting_owner", "more_info_requested"].includes(status)) owner = { ...owner, state: "current" };
  else if (status === "approved" || status === "declined") owner = { ...owner, state: "done" };
  else if (status === "ready") owner = { ...owner, state: "skipped", note: "Not needed" };
  else if (status === "closed") owner = ownerInvolved ? { ...owner, state: "done" } : { ...owner, state: "skipped", note: "Not needed" };
  const recorded: StepState = status === "closed" ? "done" : ["ready", "approved", "declined"].includes(status) ? "current" : "upcoming";
  return [
    { label: "Submitted", state: "done" },
    { label: "Rule check", state: ruleCheck, note: ruleCheck === "current" ? "Needs more facts" : undefined },
    owner,
    { label: "Recorded", state: recorded },
  ];
}

export function progressHeading(steps: ProgressStep[]): { title: string; aside: string } {
  const i = steps.findIndex((s) => s.state === "current");
  if (i < 0) return { title: "All steps done", aside: "Nothing left to do" };
  const left = steps.slice(i + 1).filter((s) => s.state === "upcoming").length;
  const aside = left === 0 ? "This is the last step" : left === 1 ? "One step after this one" : `${left} steps after this one`;
  return { title: `Step ${i + 1} of ${steps.length}: ${steps[i].label.toLowerCase()}`, aside };
}

/** The next thing someone has to do, as shown in tables and the activity list. */
export function nextStep(status: RequestStatus): { title: string; detail: string; pending: string } {
  switch (status) {
    case "needs_clarification":
      return { title: "Needs clarification", detail: "Missing details", pending: "Waiting for the missing facts. Use Update facts above." };
    case "review_required":
      return { title: "Send to owner", detail: "Owner review required", pending: "Not sent yet. Use Send to owner above." };
    case "awaiting_owner":
      return { title: "Waiting for owner", detail: "Owner decides first", pending: "Sent. Waiting for the owner's decision." };
    case "more_info_requested":
      return { title: "Reply to owner", detail: "Owner asked for more", pending: "The owner needs more information. Update the facts, then send it back." };
    case "ready":
      return { title: "Record outcome", detail: "Inside the rules", pending: "Not recorded yet. Use Record what you did above." };
    case "approved":
      return { title: "Record outcome", detail: "Approved by owner", pending: "Not recorded yet. Use Record what you did above." };
    case "declined":
      return { title: "Record outcome", detail: "Declined by owner", pending: "Not recorded yet. Use Record what you did above." };
    case "closed":
      return { title: "Done", detail: "Recorded and closed", pending: "" };
  }
}

export function whatHappensNext(status: RequestStatus, role: Role): string {
  switch (status) {
    case "needs_clarification":
      return "Some facts are missing. Add them with Update facts and the rules will check the request again.";
    case "review_required":
      return "Send this to the owner. Once the owner decides, you record the outcome here. That is the last step.";
    case "awaiting_owner":
      return role === "owner"
        ? "Make your decision. The admin then records what was done, and the request is finished."
        : "The owner is looking at this. You'll see their decision here, then you record the outcome.";
    case "more_info_requested":
      return "The owner needs more information. Update the facts, then send it back to the owner.";
    case "ready":
      return "This is inside the rules. Do it in your own systems, then record what you did here. Tutor Compass doesn't move money or change bookings.";
    case "approved":
      return "The owner approved this request. Do it in your own systems, then record what you did here.";
    case "declined":
      return "The owner declined this request. Let the family know, then record what you did here.";
    case "closed":
      return "Nothing more to do. The full record stays on this page.";
  }
}

export function ruleHeading(colour: Colour, status: RequestStatus, welfare: boolean): string {
  if (colour === "red") return welfare ? "Stop. The owner must handle this personally" : "Send this to the owner before doing anything else";
  if (colour === "amber") return status === "needs_clarification" ? "Some facts are missing" : "Check with the owner before going ahead";
  return "You can go ahead";
}

const RULE_NAMES: Record<string, string> = {
  "safety.complaint": "Safety complaint",
  "safety.welfare": "Welfare concern",
  "default.unsupported": "No policy for this",
  "default.missing_policy": "No active policy",
  "default.missing_information": "Missing information",
  "default.no_matching_rule": "No matching rule",
  "refund.under_50": "Refund under $50",
  "refund.50_to_200": "Refund $50 to $200",
  "refund.over_200": "Refund over $200",
  "lesson_change.no_fee": "No fee change",
  "lesson_change.fee_impact": "Affects fees",
  "payment_extension.up_to_7": "Extension up to 7 days",
  "payment_extension.8_to_30": "Extension 8 to 30 days",
  "payment_extension.over_30": "Extension over 30 days",
};

/** A short name for a rule id, for badges. Rules the owner added later get a tidied id. */
export function ruleName(id: string): string {
  if (RULE_NAMES[id]) return RULE_NAMES[id];
  const tail = id.split(".").pop() ?? id;
  const words = tail.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

/** "Today, 2:13 am", "Yesterday, 9:00 pm" or "14 Oct, 8:19 pm", in Sydney time. */
export function friendlyTime(iso: string, now = new Date()): string {
  const tz = "Australia/Sydney";
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-AU", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  if (day(d) === day(now)) return `Today, ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${time}`;
  const date = d.toLocaleDateString("en-AU", { timeZone: tz, day: "numeric", month: "short", ...(day(d).slice(0, 4) !== day(now).slice(0, 4) ? { year: "numeric" } : {}) });
  return `${date}, ${time}`;
}
