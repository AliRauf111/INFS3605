import type { Colour, RequestStatus, Role } from "./types";
import { enT, type Translate } from "@/lib/i18n/core";
import { makeFormat, type Format } from "@/lib/i18n/format";

// Plain-language wording for where a request is up to. Shared by the dashboard and the
// request page so both describe the same step the same way. Nothing here decides a
// colour; it only labels what the rule engine and the workflow already recorded.

export type StepState = "done" | "current" | "upcoming" | "skipped";
export type StepKey = "submitted" | "ruleCheck" | "ownerReview" | "recorded";
export type ProgressStep = { key: StepKey; label: string; state: StepState; note?: string };

export function requestProgress(status: RequestStatus, ownerInvolved: boolean, opts: { missing?: number; reviewStarted?: boolean } = {}, t: Translate = enT): ProgressStep[] {
  const missing = (opts.missing ?? 0) > 0 && ["needs_clarification", "review_required", "more_info_requested"].includes(status);
  const ruleCheck: StepState = status === "needs_clarification" || missing ? "current" : "done";
  let owner: ProgressStep = { key: "ownerReview", label: t("domain.step.ownerReview"), state: "upcoming" };
  const notNeeded = t("domain.step.notNeeded");
  if (ruleCheck !== "current" && ["review_required", "awaiting_owner", "more_info_requested", "needs_clarification"].includes(status)) {
    owner = { ...owner, state: "current", note: opts.reviewStarted ? t("domain.step.reviewStarted") : undefined };
  } else if (status === "approved" || status === "declined") owner = { ...owner, state: "done" };
  else if (status === "ready") owner = { ...owner, state: "skipped", note: notNeeded };
  else if (status === "closed") owner = ownerInvolved ? { ...owner, state: "done" } : { ...owner, state: "skipped", note: notNeeded };
  const recorded: StepState = status === "closed" ? "done" : ["ready", "approved", "declined"].includes(status) ? "current" : "upcoming";
  return [
    { key: "submitted", label: t("domain.step.submitted"), state: "done" },
    { key: "ruleCheck", label: t("domain.step.ruleCheck"), state: ruleCheck, note: ruleCheck === "current" ? t("domain.step.needsMoreFacts") : undefined },
    owner,
    { key: "recorded", label: t("domain.step.recorded"), state: recorded },
  ];
}

export function progressHeading(steps: ProgressStep[], t: Translate = enT): { title: string; aside: string } {
  const i = steps.findIndex((s) => s.state === "current");
  if (i < 0) return { title: t("domain.step.allDone"), aside: t("domain.step.nothingLeft") };
  const left = steps.slice(i + 1).filter((s) => s.state === "upcoming").length;
  const aside = left === 0 ? t("domain.step.lastStep") : t("domain.step.stepsAfter", { count: left });
  // The step's name as it reads mid-sentence ("Step 2 of 4: rule check").
  const label = t(`domain.stepInSentence.${steps[i].key}`);
  return { title: t("domain.step.heading", { n: i + 1, total: steps.length, label }), aside };
}

/** Only the owner can take these off the lists, so nothing they need to see disappears. */
export function removalNeedsOwner(status: RequestStatus, welfare: string | null): boolean {
  return status === "awaiting_owner" || (welfare === "yes" && status !== "closed");
}

export function ruleHeading(colour: Colour, status: RequestStatus, welfare: boolean, role: Role = "admin", missing = 0, t: Translate = enT): string {
  const owner = role === "owner";
  if (missing > 0 && ["needs_clarification", "review_required", "more_info_requested"].includes(status)) return t("domain.ruleHeading.missing");
  if (colour === "red") {
    if (owner) return welfare ? t("domain.ruleHeading.ownerWelfare") : t("domain.ruleHeading.ownerRed");
    return welfare ? t("domain.ruleHeading.adminWelfare") : t("domain.ruleHeading.adminRed");
  }
  if (colour === "amber") {
    if (status === "needs_clarification") return t("domain.ruleHeading.missing");
    return owner ? t("domain.ruleHeading.ownerAmber") : t("domain.ruleHeading.adminAmber");
  }
  return t("domain.ruleHeading.green");
}

const KNOWN_RULES = new Set([
  "safety.complaint", "safety.welfare", "default.unsupported", "default.missing_policy", "default.missing_information",
  "default.no_matching_rule", "refund.under_50", "refund.50_to_200", "refund.over_200", "lesson_change.no_fee",
  "lesson_change.fee_impact", "payment_extension.up_to_7", "payment_extension.8_to_30", "payment_extension.over_30",
]);

/** A short name for a rule id, for badges. Rules the owner added later get a tidied id, as written. */
export function ruleName(id: string, t: Translate = enT): string {
  if (KNOWN_RULES.has(id)) return t(`domain.ruleName.${id.replace(/\./g, "_")}` as "domain.ruleName.safety_complaint");
  const tail = id.split(".").pop() ?? id;
  const words = tail.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

/** "Today, 2:13 am", "Yesterday, 9:00 pm" or "14 Oct, 8:19 pm", in Sydney time. */
export function friendlyTime(iso: string, now = new Date(), fmt: Format = makeFormat()): string {
  return fmt.friendly(iso, now);
}
