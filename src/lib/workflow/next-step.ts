import type { Colour, RequestStatus, Role } from "@/lib/domain/types";
import { enT, type Translate } from "@/lib/i18n/core";

// The one place that decides what someone can do next on a request. The dashboard, the
// request page, Approval Alley and Compass all ask this module, and the database
// functions (transition_request, start_owner_review) check the same rules again.
//
// The decision uses who is signed in, the request's status, how many required details
// the latest rule check says are missing, and whether the owner has started a review.
// Colour never decides an action on its own: it only changes wording and whether the
// owner can add handling notes on a red or welfare request.

export const CLARIFY_STATUSES: RequestStatus[] = ["needs_clarification", "review_required", "more_info_requested"];
export const OWNER_REVIEW_STATUSES: RequestStatus[] = [...CLARIFY_STATUSES, "awaiting_owner"];
export const RECORD_STATUSES: RequestStatus[] = ["ready", "approved", "declined"];

export type TransitionAction = "send_to_owner" | "approve" | "decline" | "request_info" | "record_and_close";

export type WorkflowInput = {
  role: Role;
  status: RequestStatus;
  /** Required details the latest rule check says are missing. */
  missing: number;
  /** When the owner pressed Start Review, if they have. */
  reviewStartedAt?: string | null;
  colour?: Colour;
  welfare?: boolean;
};

export type PrimaryKind = "complete_details" | "send_to_owner" | "awaiting_owner" | "start_review" | "continue_review" | "record_outcome";

/** Which dashboard queue the request belongs in for this person. */
export type Queue = "clarify" | "send" | "review" | "owner" | "record" | "done";

export type Workflow = {
  queue: Queue;
  /** Short next step, as in the dashboard's Next Step column. */
  title: string;
  detail: string;
  /** The "next" line at the top of the activity list. Empty when nothing is left. */
  pending: string;
  /** The "What happens next" box. */
  whatNext: string;
  primary: { kind: PrimaryKind; label: string; disabled: boolean } | null;
  missingDetails: boolean;
  reviewStarted: boolean;
  can: {
    completeDetails: boolean;
    sendToOwner: boolean;
    startReview: boolean;
    approve: boolean;
    decline: boolean;
    requestInfo: boolean;
    handlingNote: boolean;
    recordOutcome: boolean;
  };
  /** Why Approve is not offered while the owner can otherwise decide. */
  approveBlocked: string | null;
};

export const PRIMARY_LABELS: Record<PrimaryKind, string> = {
  complete_details: "Complete Missing Details",
  send_to_owner: "Send to Owner",
  awaiting_owner: "Awaiting Owner Decision",
  start_review: "Start Review",
  continue_review: "Continue Review",
  record_outcome: "Record Outcome",
};

/** The owner may review this request now (whether or not an admin sent it). */
export function ownerCanReview(status: RequestStatus, missing: number): boolean {
  if (!OWNER_REVIEW_STATUSES.includes(status)) return false;
  return !(status === "needs_clarification" && missing > 0);
}

/** Workflow actions this person may take. The database function enforces the same list. */
export function allowedTransitions(input: Pick<WorkflowInput, "role" | "status" | "missing">): Set<TransitionAction> {
  const { role, status, missing } = input;
  const out = new Set<TransitionAction>();
  if (role === "admin" && CLARIFY_STATUSES.includes(status) && missing === 0) out.add("send_to_owner");
  if (role === "owner" && ownerCanReview(status, missing)) {
    out.add("decline");
    out.add("request_info");
    if (missing === 0) out.add("approve");
  }
  if (RECORD_STATUSES.includes(status)) out.add("record_and_close");
  return out;
}

/** What this person can do next. The wording is in the reader's language; the rules are the same in every language. */
export function workflowFor(input: WorkflowInput, t: Translate = enT): Workflow {
  const { role, status, missing } = input;
  const owner = role === "owner";
  const allowed = allowedTransitions(input);
  const missingDetails = missing > 0 && OWNER_REVIEW_STATUSES.includes(status);
  const reviewable = owner && ownerCanReview(status, missing);
  const reviewStarted = Boolean(input.reviewStartedAt) && reviewable;
  const sensitive = input.colour === "red" || Boolean(input.welfare);
  const can: Workflow["can"] = {
    completeDetails: CLARIFY_STATUSES.includes(status),
    sendToOwner: allowed.has("send_to_owner"),
    startReview: reviewable,
    approve: allowed.has("approve"),
    decline: allowed.has("decline"),
    requestInfo: allowed.has("request_info"),
    handlingNote: reviewable && sensitive,
    recordOutcome: allowed.has("record_and_close"),
  };
  const approveBlocked = owner && reviewable && !can.approve ? t("workflow.approveBlocked") : null;
  const detailsLine = t("workflow.detailsMissing", { count: missing });
  const base = { missingDetails, reviewStarted, can, approveBlocked };
  const label = (kind: PrimaryKind) => t(`workflow.primary.${kind}`);
  const primary = (kind: PrimaryKind, disabled = false) => ({ kind, label: label(kind), disabled });

  if (status === "closed") {
    return { ...base, queue: "done", title: t("workflow.done"), detail: t("workflow.recordedClosed"), pending: "", whatNext: t("workflow.nothingMore"), primary: null };
  }

  if (RECORD_STATUSES.includes(status)) {
    const detail = status === "ready" ? t("workflow.insideRules") : status === "approved" ? t("domain.status.approved") : t("domain.status.declined");
    const whatNext = status === "ready" ? t("workflow.whatNext.ready") : status === "approved" ? t("workflow.whatNext.approved") : t("workflow.whatNext.declined");
    return { ...base, queue: "record", title: label("record_outcome"), detail, pending: t("workflow.pending.notRecorded"), whatNext, primary: primary("record_outcome") };
  }

  // Missing details come first for everyone. Nothing goes to the owner, and nothing is
  // approved, until the rule check has every required detail.
  if (missingDetails && CLARIFY_STATUSES.includes(status)) {
    return {
      ...base,
      queue: "clarify",
      title: label("complete_details"),
      detail: detailsLine,
      pending: t("workflow.pending.waitingDetails", { details: detailsLine }),
      whatNext: owner && reviewable ? t("workflow.whatNext.detailsOwner", { details: detailsLine }) : t("workflow.whatNext.details", { details: detailsLine }),
      primary: primary("complete_details"),
    };
  }

  if (owner) {
    if (reviewable) {
      const detail =
        status === "awaiting_owner" ? t("workflow.detail.sentByAdmin") : status === "more_info_requested" ? t("workflow.detail.youAsked") : status === "needs_clarification" ? t("workflow.detail.detailsComplete") : t("workflow.detail.notSentYet");
      return {
        ...base,
        queue: "review",
        title: t("workflow.reviewAndHandle"),
        detail,
        pending: reviewStarted ? t("workflow.pending.reviewStarted") : t("workflow.pending.waitingReview"),
        whatNext: reviewStarted
          ? sensitive ? t("workflow.whatNext.continueSensitive") : t("workflow.whatNext.continue")
          : t("workflow.whatNext.start"),
        primary: primary(reviewStarted ? "continue_review" : "start_review"),
      };
    }
  } else {
    if (allowed.has("send_to_owner")) {
      const detail = status === "more_info_requested" ? t("workflow.detail.ownerAskedMore") : status === "needs_clarification" ? t("workflow.detail.recordsNeedChecking") : t("domain.status.review_required");
      return {
        ...base,
        queue: "send",
        title: label("send_to_owner"),
        detail,
        pending: status === "more_info_requested" ? t("workflow.pending.ownerNeedsMore") : t("workflow.pending.notSent"),
        whatNext: status === "more_info_requested" ? t("workflow.whatNext.ownerNeedsMore") : t("workflow.whatNext.send"),
        primary: primary("send_to_owner"),
      };
    }
    if (status === "awaiting_owner") {
      return {
        ...base,
        queue: "owner",
        title: label("awaiting_owner"),
        detail: t("workflow.detail.ownerDecidesFirst"),
        pending: t("workflow.pending.sent"),
        whatNext: t("workflow.whatNext.ownerLooking"),
        primary: primary("awaiting_owner", true),
      };
    }
  }

  // Anything left (for example a legacy request waiting for the owner with details missing).
  return {
    ...base,
    queue: "clarify",
    title: label("complete_details"),
    detail: detailsLine,
    pending: t("workflow.pending.detailsOnly", { details: detailsLine }),
    whatNext: t("workflow.whatNext.detailsBefore", { details: detailsLine }),
    primary: can.completeDetails ? primary("complete_details") : null,
  };
}

/** Required details that count as missing: "policy" and "request_type" can't be filled in. */
export function countMissing(missing: Array<{ fact: string }> | null | undefined): number {
  return (missing ?? []).filter((m) => m.fact !== "policy" && m.fact !== "request_type").length;
}
