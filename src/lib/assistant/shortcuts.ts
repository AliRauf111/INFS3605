// The Compass welcome shortcuts. This is the one definition the welcome screen, the
// new-chat screen and the server all use, so they can never drift apart. Each shortcut
// has a stable id that the server maps to a working workflow.

export const SHORTCUT_IDS = ["attention", "lesson_change", "payment_extension", "tutor_absence"] as const;
export type ShortcutId = (typeof SHORTCUT_IDS)[number];

/** The three agentic workflows. "attention" is a read-only summary, not a workflow. */
export const WORKFLOW_IDS = ["lesson_change", "payment_extension", "tutor_absence"] as const;
export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export type Shortcut = {
  id: ShortcutId;
  label: string;
  /** One line under the label, so each button says what it does. */
  hint: string;
  /** Full width on its own row, or one of the workflow buttons below it. */
  layout: "wide" | "workflow";
};

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "attention", label: "What Needs My Attention?", hint: "Decisions, clarifications, waiting workflows and failed actions", layout: "wide" },
  { id: "lesson_change", label: "Lesson Change", hint: "Move a lesson to a new time", layout: "workflow" },
  { id: "payment_extension", label: "Payment Extension", hint: "Give an invoice more time", layout: "workflow" },
  { id: "tutor_absence", label: "Tutor Absence", hint: "Cover or move a tutor's lessons", layout: "workflow" },
];

/** The first thing Compass says when a workflow starts. */
export const OPENING_QUESTIONS: Record<WorkflowId, string> = {
  lesson_change: "Which lesson would you like to change? You can share the booking reference or paste the parent's message.",
  payment_extension: "Which invoice needs more time? Share the invoice reference or paste the parent's request.",
  tutor_absence: "Which tutor is unavailable, and when? You can also paste their message.",
};

export const WORKFLOW_LABELS: Record<WorkflowId, string> = {
  lesson_change: "Lesson Change",
  payment_extension: "Payment Extension",
  tutor_absence: "Tutor Absence",
};

export function isWorkflowId(id: string): id is WorkflowId {
  return (WORKFLOW_IDS as readonly string[]).includes(id);
}
