import type { Colour, RequestStatus, Role } from "@/lib/domain/types";

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

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function workflowFor(input: WorkflowInput): Workflow {
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
  const approveBlocked = owner && reviewable && !can.approve ? "Approve is not available until the missing details are complete." : null;
  const detailsLine = `${missing} required ${plural(missing, "detail is", "details are")} missing`;
  const base = { missingDetails, reviewStarted, can, approveBlocked };
  const primary = (kind: PrimaryKind, disabled = false) => ({ kind, label: PRIMARY_LABELS[kind], disabled });

  if (status === "closed") {
    return { ...base, queue: "done", title: "Done", detail: "Recorded and closed", pending: "", whatNext: "Nothing more to do. The full record stays on this page.", primary: null };
  }

  if (RECORD_STATUSES.includes(status)) {
    const detail = status === "ready" ? "Inside the rules" : status === "approved" ? "Approved by Owner" : "Declined by Owner";
    const whatNext =
      status === "ready"
        ? "This is inside the rules. Do it in your own systems, then record what you did here. Tutor Compass doesn't move money or change bookings."
        : status === "approved"
          ? "The owner approved this request. Do it in your own systems, then record what you did here."
          : "The owner declined this request. Let the family know, then record what you did here.";
    return { ...base, queue: "record", title: "Record Outcome", detail, pending: "Not recorded yet. Use Record Outcome above.", whatNext, primary: primary("record_outcome") };
  }

  // Missing details come first for everyone. Nothing goes to the owner, and nothing is
  // approved, until the rule check has every required detail.
  if (missingDetails && CLARIFY_STATUSES.includes(status)) {
    return {
      ...base,
      queue: "clarify",
      title: "Complete Missing Details",
      detail: detailsLine,
      pending: `Waiting for the missing details. ${detailsLine}. Use Complete Missing Details above.`,
      whatNext: `${detailsLine} before a decision can be made. Add them with Complete Missing Details and the rules will check the request again.${owner && reviewable ? " You can still start a review, but you can't approve it yet." : ""}`,
      primary: primary("complete_details"),
    };
  }

  if (owner) {
    if (reviewable) {
      const detail =
        status === "awaiting_owner" ? "Sent by the admin team" : status === "more_info_requested" ? "You asked for information" : status === "needs_clarification" ? "Details complete" : "Not sent by the admin team yet";
      return {
        ...base,
        queue: "review",
        title: "Review and Handle",
        detail,
        pending: reviewStarted
          ? "Review started. Use Continue Review above to approve, decline or ask for information."
          : "Waiting for your review. Use Start Review above. Opening this page doesn't start it.",
        whatNext: reviewStarted
          ? `Continue your review and record your decision. ${sensitive ? "You can also add handling notes and next steps as you go. " : ""}The admin team then records what was done.`
          : "Start the review when you're ready. Starting it records that you're handling this. It doesn't approve, close or change anything else.",
        primary: primary(reviewStarted ? "continue_review" : "start_review"),
      };
    }
  } else {
    if (allowed.has("send_to_owner")) {
      const detail = status === "more_info_requested" ? "Owner asked for more" : status === "needs_clarification" ? "Records need checking" : "Owner Review Required";
      return {
        ...base,
        queue: "send",
        title: "Send to Owner",
        detail,
        pending: status === "more_info_requested" ? "The owner needs more information. Update the facts if needed, then use Send to Owner above." : "Not sent yet. Use Send to Owner above.",
        whatNext:
          status === "more_info_requested"
            ? "The owner needs more information. Update the facts if needed, then send it back to the owner."
            : "Send this to the owner. Once the owner decides, you record the outcome here. That is the last step.",
        primary: primary("send_to_owner"),
      };
    }
    if (status === "awaiting_owner") {
      return {
        ...base,
        queue: "owner",
        title: "Awaiting Owner Decision",
        detail: "Owner decides first",
        pending: "Sent. Waiting for the owner's decision.",
        whatNext: "The owner is looking at this. You'll see their decision here, then you record the outcome.",
        primary: primary("awaiting_owner", true),
      };
    }
  }

  // Anything left (for example a legacy request waiting for the owner with details missing).
  return {
    ...base,
    queue: "clarify",
    title: "Complete Missing Details",
    detail: detailsLine,
    pending: `${detailsLine}.`,
    whatNext: `${detailsLine}. Add them before a decision is made.`,
    primary: can.completeDetails ? primary("complete_details") : null,
  };
}

/** Required details that count as missing: "policy" and "request_type" can't be filled in. */
export function countMissing(missing: Array<{ fact: string }> | null | undefined): number {
  return (missing ?? []).filter((m) => m.fact !== "policy" && m.fact !== "request_type").length;
}
