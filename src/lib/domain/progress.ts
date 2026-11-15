import type { Colour, RequestStatus, Role } from "./types";

// Plain-language wording for where a request is up to. Shared by the dashboard and the
// request page so both describe the same step the same way. Nothing here decides a
// colour; it only labels what the rule engine and the workflow already recorded.

export type StepState = "done" | "current" | "upcoming" | "skipped";
export type ProgressStep = { label: string; state: StepState; note?: string };

export const STEP_LABELS = ["Submitted", "Rule check", "Owner review", "Recorded"] as const;

export function requestProgress(status: RequestStatus, ownerInvolved: boolean, opts: { missing?: number; reviewStarted?: boolean } = {}): ProgressStep[] {
  const missing = (opts.missing ?? 0) > 0 && ["needs_clarification", "review_required", "more_info_requested"].includes(status);
  const ruleCheck: StepState = status === "needs_clarification" || missing ? "current" : "done";
  let owner: ProgressStep = { label: "Owner review", state: "upcoming" };
  if (ruleCheck !== "current" && ["review_required", "awaiting_owner", "more_info_requested", "needs_clarification"].includes(status)) {
    owner = { ...owner, state: "current", note: opts.reviewStarted ? "Review started" : undefined };
  } else if (status === "approved" || status === "declined") owner = { ...owner, state: "done" };
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

/** Only the owner can take these off the lists, so nothing they need to see disappears. */
export function removalNeedsOwner(status: RequestStatus, welfare: string | null): boolean {
  return status === "awaiting_owner" || (welfare === "yes" && status !== "closed");
}

export function ruleHeading(colour: Colour, status: RequestStatus, welfare: boolean, role: Role = "admin", missing = 0): string {
  const owner = role === "owner";
  if (missing > 0 && ["needs_clarification", "review_required", "more_info_requested"].includes(status)) return "Some facts are missing";
  if (colour === "red") {
    if (owner) return welfare ? "Welfare concern. You handle this personally" : "This needs your review before anything else happens";
    return welfare ? "Stop. The owner must handle this personally" : "The owner must review this before anything else happens";
  }
  if (colour === "amber") {
    if (status === "needs_clarification") return "Some facts are missing";
    return owner ? "This needs your approval before going ahead" : "Check with the owner before going ahead";
  }
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
