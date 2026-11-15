// The four example requests in the Compass Decision Orbit on the landing page preview.
// Each one follows a real rule from the fictional demo rule set (src/lib/engine/
// default-policies.ts) or the Tutor Absence workflow, so the outcome shown here is the
// outcome the app would reach. The families, tutors and amounts are made up.

export type OrbitOutcome = "ready" | "info" | "owner";

export type OrbitRequest = {
  id: "lesson_change" | "payment_extension" | "tutor_absence" | "owner_approval";
  title: string;
  /** One line on the card. */
  summary: string;
  /** What Compass says in its speech bubble when the card is picked. */
  bubble: string;
  outcome: OrbitOutcome;
  /** The traffic light the rule gives: green, amber or red. */
  signal: "green" | "amber" | "red";
};

export const OUTCOME_LABELS: Record<OrbitOutcome, string> = {
  ready: "Ready for Admin",
  info: "Needs More Information",
  owner: "Requires Owner Review",
};

export const ORBIT_REQUESTS: readonly OrbitRequest[] = [
  {
    id: "lesson_change",
    title: "Lesson Change",
    summary: "Reschedule request",
    bubble: "No fee change, so this one is inside your rules.",
    outcome: "ready",
    signal: "green",
  },
  {
    id: "payment_extension",
    title: "Payment Extension",
    summary: "More time to pay",
    bubble: "14 days is over the admin limit, so this goes to you.",
    outcome: "owner",
    signal: "amber",
  },
  {
    id: "tutor_absence",
    title: "Tutor Absence",
    summary: "Tutor unavailable",
    bubble: "I need the dates first, then I can look for cover.",
    outcome: "info",
    signal: "amber",
  },
  {
    id: "owner_approval",
    title: "Owner Approval",
    summary: "Refund over the limit",
    bubble: "Refunds over $200 are your call. I'll prepare it.",
    outcome: "owner",
    signal: "red",
  },
];
