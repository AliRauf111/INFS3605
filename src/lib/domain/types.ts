// Shared vocabulary for the whole app. Keeping these lists in one place means the
// wizard, the AI intake, the decision engine and the database checks all agree.

export const REQUEST_TYPES = ["refund", "lesson_change", "payment_extension", "other"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  refund: "Refund",
  lesson_change: "Lesson change",
  payment_extension: "Payment extension",
  other: "Something else",
};

// "unsure" is a real answer. A missing answer is stored as null. Neither one is ever
// treated as "no".
export const TRI_STATES = ["yes", "no", "unsure"] as const;
export type TriState = (typeof TRI_STATES)[number];

export const TRI_STATE_LABELS: Record<TriState, string> = {
  yes: "Yes",
  no: "No",
  unsure: "Not sure",
};

export const COLOURS = ["green", "amber", "red"] as const;
export type Colour = (typeof COLOURS)[number];

export const COLOUR_LABELS: Record<Colour, string> = {
  green: "Green: you may follow the approved steps",
  amber: "Amber: clarification or owner approval needed",
  red: "Red: stop and escalate to the owner",
};

export const COLOUR_SHORT: Record<Colour, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
};

// Workflow status is kept separate from the decision colour. An amber request can be
// approved later without its original decision being rewritten.
export const STATUSES = [
  "ready",
  "needs_clarification",
  "review_required",
  "awaiting_owner",
  "more_info_requested",
  "approved",
  "declined",
  "closed",
] as const;
export type RequestStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  ready: "Ready for admin",
  needs_clarification: "Needs Clarification",
  review_required: "Owner review required",
  awaiting_owner: "Waiting for Owner",
  more_info_requested: "Owner asked for more information",
  approved: "Approved by owner",
  declined: "Declined by owner",
  closed: "Closed",
};

// Actions the app can prepare. None of them touch an outside system: the alpha does
// not process payments, send messages or change bookings.
export const ACTIONS = [
  "prepare_parent_response",
  "prepare_tutor_message",
  "prepare_escalation_summary",
  "prepare_reschedule_proposal",
  "prepare_admin_checklist",
  "send_to_owner",
] as const;
export type ActionKey = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<ActionKey, string> = {
  prepare_parent_response: "Prepare a parent response",
  prepare_tutor_message: "Prepare a tutor message",
  prepare_escalation_summary: "Prepare an owner escalation summary",
  prepare_reschedule_proposal: "Prepare a rescheduling proposal",
  prepare_admin_checklist: "Prepare an admin checklist",
  send_to_owner: "Send to the owner for review",
};

export const DRAFT_KINDS = [
  "parent_response",
  "tutor_message",
  "escalation_summary",
  "reschedule_proposal",
  "admin_checklist",
] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_LABELS: Record<DraftKind, string> = {
  parent_response: "Parent response",
  tutor_message: "Tutor message",
  escalation_summary: "Owner escalation summary",
  reschedule_proposal: "Rescheduling proposal",
  admin_checklist: "Admin checklist",
};

export const ROLES = ["admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

// Where a knowledge hub record came from. The UI always shows this label.
export const DATA_LABELS = ["live_connected", "imported", "fictional_demo"] as const;
export type DataLabel = (typeof DATA_LABELS)[number];

export const DATA_LABEL_TEXT: Record<DataLabel, string> = {
  live_connected: "Live connected",
  imported: "Imported",
  fictional_demo: "Fictional demonstration data",
};
