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
  /** What the request says, in full. */
  message: string;
  /** What Compass says in its speech bubble when the card is picked. */
  bubble: string;
  /** How Compass works through it, step by step. */
  steps: string[];
  /** The rule id from the rule set, or the workflow check it comes from. */
  rule: { id: string; text: string };
  outcome: OrbitOutcome;
  /** The traffic light the rule gives: green, amber or red. */
  signal: "green" | "amber" | "red";
  /** The Compass workflow this opens in the demo, if there is one. */
  workflow: "lesson_change" | "payment_extension" | "tutor_absence" | "attention";
  workflowLabel: string;
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
    message: "A parent asks to move Thursday's 5pm maths lesson to Saturday morning. The fee stays the same.",
    bubble: "No fee change, so this one is inside your rules.",
    steps: [
      "Finds the booking and the tutor's free times on Saturday.",
      "Checks whether the change affects fees. It doesn't.",
      "Prepares a reply to the family and a note for the tutor.",
    ],
    rule: { id: "lesson_change.no_fee", text: "A reschedule with no change to fees can go ahead once the family agrees to the new time." },
    outcome: "ready",
    signal: "green",
    workflow: "lesson_change",
    workflowLabel: "Try the Lesson Change workflow",
  },
  {
    id: "payment_extension",
    title: "Payment Extension",
    summary: "More time to pay",
    message: "A family asks for 14 more days to pay this term's invoice.",
    bubble: "14 days is over the admin limit, so this goes to you.",
    steps: [
      "Finds the outstanding invoice and its due date.",
      "Compares the 14 days asked for with your extension limits.",
      "Writes a holding reply and a short summary for your decision.",
    ],
    rule: { id: "payment_extension.8_to_30", text: "Extensions of 8 to 30 days need the owner's approval. Up to 7 days is fine for admins." },
    outcome: "owner",
    signal: "amber",
    workflow: "payment_extension",
    workflowLabel: "Try the Payment Extension workflow",
  },
  {
    id: "tutor_absence",
    title: "Tutor Absence",
    summary: "Tutor unavailable",
    message: "A tutor says they're unwell and can't teach this week, but doesn't say which days.",
    bubble: "I need the dates first, then I can look for cover.",
    steps: [
      "Asks which days the tutor is away and which lessons are affected.",
      "Looks for a free tutor who teaches the same subject.",
      "Each family and the cover tutor must agree before anything changes.",
    ],
    rule: { id: "Tutor Absence workflow", text: "Cover needs a free, qualified tutor, and every change needs the family's agreement." },
    outcome: "info",
    signal: "amber",
    workflow: "tutor_absence",
    workflowLabel: "Try the Tutor Absence workflow",
  },
  {
    id: "owner_approval",
    title: "Owner Approval",
    summary: "Refund over the limit",
    message: "A parent asks for a $260 refund after cancelling the rest of the term.",
    bubble: "Refunds over $200 are your call. I'll prepare it.",
    steps: [
      "Matches the refund to the unused lessons on the booking.",
      "Sees $260 is above the limit admins can handle.",
      "Stops routine processing and sends you a decision-ready summary.",
    ],
    rule: { id: "refund.over_200", text: "Refunds above $200 are decided by the owner only. Compass never promises one." },
    outcome: "owner",
    signal: "red",
    workflow: "attention",
    workflowLabel: "See what needs your attention",
  },
];
