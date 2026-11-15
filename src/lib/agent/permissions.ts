import type { RequestStatus, Role } from "@/lib/domain/types";
import { CLARIFY_STATUSES, OWNER_REVIEW_STATUSES, RECORD_STATUSES, allowedTransitions, type TransitionAction } from "@/lib/workflow/next-step";

// One map of what Compass may prepare, who may confirm it and from which statuses. The
// proposal service, the review cards and the tests all read this list. The database
// functions check the same rules again, so this map can never widen what is allowed.
// Account access, sign-in and role changes are deliberately absent: Compass has no
// tool for them.

export const PROPOSAL_ACTIONS = [
  "request.create",
  "request.send_to_owner",
  "request.approve",
  "request.decline",
  "request.request_info",
  "request.record_outcome",
  "draft.save",
  "booking.reschedule",
  "invoice.extend_due_date",
  "tutor.record_absence",
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export type ActionRule = {
  label: string;
  /** Who may ask Compass to prepare it. */
  prepare: Role[];
  /** Who must confirm it. "staff" is an admin or the owner. */
  confirm: "staff" | "owner";
  /** Statuses the request must be in. Null for actions that don't need one. */
  from: RequestStatus[] | null;
  /** Status after the change, when the action moves the workflow. */
  to: RequestStatus | null;
  needsNote: boolean;
  /** What a successful confirmation means, in words that can't be mistaken for a real-world action. */
  outcome: string;
};

export const ACTION_RULES: Record<ProposalAction, ActionRule> = {
  "request.create": {
    label: "Save Request",
    prepare: ["admin", "owner"],
    confirm: "staff",
    from: null,
    to: null,
    needsNote: false,
    outcome: "Saves a new request in Tutor Compass with the rule engine's result. Nothing is refunded, booked or sent.",
  },
  "request.send_to_owner": {
    label: "Send to Owner",
    // The owner reviews requests directly and never sends one to themselves.
    prepare: ["admin"],
    confirm: "staff",
    from: CLARIFY_STATUSES,
    to: "awaiting_owner",
    needsNote: true,
    outcome: "Moves the request to Waiting for Owner with your note. Nothing is sent to the family.",
  },
  "request.approve": {
    label: "Approve",
    prepare: ["owner"],
    confirm: "owner",
    from: OWNER_REVIEW_STATUSES,
    to: "approved",
    needsNote: true,
    outcome: "Records your decision as Approved by Owner. It does not move money, change a booking or contact the family.",
  },
  "request.decline": {
    label: "Decline",
    prepare: ["owner"],
    confirm: "owner",
    from: OWNER_REVIEW_STATUSES,
    to: "declined",
    needsNote: true,
    outcome: "Records your decision as Declined by Owner. Nothing is sent to the family.",
  },
  "request.request_info": {
    label: "Ask for Information",
    prepare: ["owner"],
    confirm: "owner",
    from: OWNER_REVIEW_STATUSES,
    to: "more_info_requested",
    needsNote: true,
    outcome: "Sends the request back to the admin team with your questions. Nothing is sent to the family.",
  },
  "request.record_outcome": {
    label: "Record Outcome",
    prepare: ["admin", "owner"],
    confirm: "staff",
    from: RECORD_STATUSES,
    to: "closed",
    needsNote: true,
    outcome: "Records what was done and closes the request. Tutor Compass does not carry out the action itself.",
  },
  "draft.save": {
    label: "Save Draft",
    prepare: ["admin", "owner"],
    confirm: "staff",
    from: null,
    to: null,
    needsNote: false,
    outcome: "Saves the draft on the request so others can see it. It is not sent to anyone.",
  },
  // The workflow actions. They change Tutor Compass's own records only once the owner's
  // rules made the request Ready for Admin or the owner approved it.
  "booking.reschedule": {
    label: "Move Lesson",
    prepare: ["admin", "owner"],
    confirm: "staff",
    from: ["ready", "approved"],
    to: "closed",
    needsNote: false,
    outcome: "Moves the lesson on Tutor Compass's timetable and closes the request. Nothing is sent to the family or the tutor.",
  },
  "invoice.extend_due_date": {
    label: "Extend Due Date",
    prepare: ["admin", "owner"],
    confirm: "staff",
    from: ["ready", "approved"],
    to: "closed",
    needsNote: false,
    outcome: "Changes the due date on Tutor Compass's record of the invoice, replaces its reminder schedule and closes the request. No payment system is connected and no reminder is sent.",
  },
  "tutor.record_absence": {
    label: "Record Absence",
    prepare: ["admin", "owner"],
    confirm: "staff",
    from: null,
    to: null,
    needsNote: false,
    outcome: "Records the tutor as away for these dates, so Compass stops offering their times. It doesn't move any lesson by itself.",
  },
};

/** Workflow actions that change a lesson, an invoice or a tutor's calendar. */
export const WORKFLOW_ACTIONS: ProposalAction[] = ["booking.reschedule", "invoice.extend_due_date", "tutor.record_absence"];

export const OWNER_DECISIONS: ProposalAction[] = ["request.approve", "request.decline", "request.request_info"];

export type Permission = { ok: true } | { ok: false; reason: string; alternative: ProposalAction | null };

const TRANSITION_OF: Partial<Record<ProposalAction, TransitionAction>> = {
  "request.send_to_owner": "send_to_owner",
  "request.approve": "approve",
  "request.decline": "decline",
  "request.request_info": "request_info",
  "request.record_outcome": "record_and_close",
};

/**
 * Can this person ask Compass to prepare this action on a request in this status? Workflow
 * actions go through the shared next-step rules, so Compass offers exactly what the
 * request page offers. `missing` is the number of required details still missing.
 */
export function canPrepare(action: ProposalAction, role: Role, status: RequestStatus | null, missing = 0): Permission {
  const rule = ACTION_RULES[action];
  if (action === "request.send_to_owner" && role === "owner") {
    return { ok: false, reason: "You're the owner, so there's nothing to send. Open the request and use Start Review instead.", alternative: null };
  }
  if (!rule.prepare.includes(role)) {
    const alternative = status && CLARIFY_STATUSES.includes(status) && missing === 0 ? "request.send_to_owner" : null;
    return {
      ok: false,
      reason:
        status === "awaiting_owner"
          ? "Only the owner can make this decision. The request is already waiting for the owner."
          : `Only the owner can ${rule.label.toLowerCase()} a request.${alternative ? " You can send it to the owner instead." : ""}`,
      alternative,
    };
  }
  if (rule.from && (!status || !rule.from.includes(status))) {
    return { ok: false, reason: `${rule.label} isn't available while the request is ${status ?? "unsaved"}.`, alternative: null };
  }
  const transition = TRANSITION_OF[action];
  if (transition && status && !allowedTransitions({ role, status, missing }).has(transition)) {
    return {
      ok: false,
      reason: missing > 0
        ? `${rule.label} isn't available until the missing details are complete. Use Complete Missing Details on the request first.`
        : `${rule.label} isn't available while the request is ${status}.`,
      alternative: null,
    };
  }
  return { ok: true };
}

/** May this person confirm a proposal that needs this role? Checked again in the database. */
export function canConfirm(required: "staff" | "owner", role: Role): boolean {
  return required === "staff" || role === "owner";
}

/** The workflow actions this person could prepare for a request in this status, in display order. */
export function availableActions(role: Role, status: RequestStatus, missing = 0): ProposalAction[] {
  const order: ProposalAction[] = ["request.approve", "request.decline", "request.request_info", "request.send_to_owner", "request.record_outcome"];
  return order.filter((a) => canPrepare(a, role, status, missing).ok);
}
