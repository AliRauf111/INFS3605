import { formatAud } from "@/lib/domain/money";
import {
  type DraftKind,
  type RequestStatus,
  REQUEST_TYPE_LABELS,
  STATUS_LABELS,
  TRI_STATE_LABELS,
  type Colour,
  type RequestType,
  type TriState,
} from "@/lib/domain/types";

// Draft wording. Templates are deterministic and always available. A draft is only ever
// text for a person to edit and send themselves: the app sends nothing.

export type DraftContext = {
  requestId: string;
  requestType: RequestType;
  amountCents: number | null;
  complaint: TriState | null;
  welfare: TriState | null;
  bookingId: string | null;
  studentName: string | null;
  tutorName: string | null;
  subject: string | null;
  slotText: string | null;
  context: string;
  colour: Colour;
  status: RequestStatus;
  matchedRuleId: string;
  policyVersion: string;
  explanation: string;
  nextSteps: string[];
  missing: string[];
  ownerNote: string | null;
};

const tri = (v: TriState | null) => (v ? TRI_STATE_LABELS[v] : "Not answered");

export function templateDraft(kind: DraftKind, c: DraftContext): string {
  const child = c.studentName ? c.studentName.split(" ")[0] : "your child";
  const approved = c.status === "approved" || c.status === "closed";
  switch (kind) {
    case "parent_response": {
      if (c.welfare === "yes") {
        return "Thank you for letting us know. The owner of the business will contact you personally as soon as possible.";
      }
      if (c.colour === "green" && c.requestType === "refund") {
        return `Hello,\n\nThank you for your message about ${child}'s lessons. We have checked the booking and your refund request of ${formatAud(c.amountCents)} meets our refund policy. We will be in touch again once the refund is processed.\n\nKind regards`;
      }
      if (c.colour === "green" && c.requestType === "lesson_change") {
        return `Hello,\n\nThank you for your message. ${c.tutorName ?? "The tutor"} is available ${c.slotText ?? "at the new time"}. Please reply to confirm this suits you and we will update the booking.\n\nKind regards`;
      }
      if (c.colour === "green" && c.requestType === "payment_extension") {
        return "Hello,\n\nThank you for getting in touch about the invoice. We can offer a short extension. We will confirm the new due date in writing shortly.\n\nKind regards";
      }
      if (c.missing.length) {
        return `Hello,\n\nThank you for your message about ${child}. Before we can help, could you please confirm the following:\n${c.missing.map((m) => `- ${m}`).join("\n")}\n\nKind regards`;
      }
      if (approved && c.ownerNote) {
        return `Hello,\n\nThank you for your patience. The owner has reviewed your request about ${child}. We will be in touch with the next steps shortly.\n\nKind regards`;
      }
      return `Hello,\n\nThank you for your message about ${child}. We are checking your request and will get back to you soon. We have not made a decision yet.\n\nKind regards`;
    }
    case "tutor_message":
      return `Hi ${c.tutorName?.split(" ")[0] ?? "there"},\n\nThis is a heads-up about ${child}'s ${c.subject ?? "lessons"} (booking ${c.bookingId ?? "not confirmed"}). ${
        c.requestType === "lesson_change"
          ? `The family has asked to move a lesson${c.slotText ? ` to ${c.slotText}` : ""}. Nothing is changed until the family confirms and the booking is updated.`
          : "There is an open request on this booking. No action is needed from you yet."
      }\n\nThanks`;
    case "escalation_summary":
      if (c.welfare === "yes") {
        return [
          "RESTRICTED: welfare handover for the owner only",
          `Request: ${c.requestId}`,
          `Booking: ${c.bookingId ?? "not confirmed"}`,
          "What was reported (as recorded by the admin):",
          c.context || "(no detail recorded)",
          "Procedure: follow KB-01 Welfare Escalation Procedure. Phone the owner as well as sending this.",
        ].join("\n");
      }
      return [
        `Owner review: ${REQUEST_TYPE_LABELS[c.requestType]}${c.amountCents !== null ? ` of ${formatAud(c.amountCents)}` : ""}`,
        `Booking: ${c.bookingId ?? "not confirmed"}${c.studentName ? ` (${c.studentName}${c.subject ? `, ${c.subject}` : ""})` : ""}`,
        `Decision: ${c.colour.toUpperCase()} under ${c.matchedRuleId} (${c.policyVersion})`,
        `Why: ${c.explanation}`,
        `Complaint: ${tri(c.complaint)}. Welfare: ${tri(c.welfare)}.`,
        c.missing.length ? `Still unconfirmed: ${c.missing.join("; ")}` : "All required facts are confirmed.",
        c.context ? `Context from admin: ${c.context}` : "",
        "Decision needed: approve, decline or ask for more information.",
      ]
        .filter(Boolean)
        .join("\n");
    case "reschedule_proposal":
      return `Proposed change for booking ${c.bookingId ?? "(not confirmed)"}\nStudent: ${c.studentName ?? "not confirmed"}\nTutor: ${c.tutorName ?? "not confirmed"}\nNew time: ${c.slotText ?? "not chosen"}\nFee change: ${c.requestType === "lesson_change" ? "none expected" : "check"}\nStatus: proposal only. The booking has not been changed.`;
    case "admin_checklist":
      return [`Checklist for request ${c.requestId} (${STATUS_LABELS[c.status]})`, ...c.nextSteps.map((s) => `[ ] ${s}`), "[ ] Record what you did on this request."].join("\n");
  }
}

// Phrases that would promise something the app has not done.
const PROMISE_PATTERNS = [
  /\b(has|have) been (refunded|processed|approved|rescheduled|moved|changed)\b/i,
  /\byour refund (is|has been) (approved|confirmed|on its way|processed)\b/i,
  /\bwe (have|'ve) (approved|refunded|processed|rescheduled)\b/i,
  /\b(is|are) now (approved|confirmed|booked)\b/i,
  /\bguarantee\b/i,
];

export function findUnsupportedPromises(text: string, status: RequestStatus): string[] {
  const hits = PROMISE_PATTERNS.filter((p) => p.test(text)).map((p) => (text.match(p)?.[0] ?? "").trim());
  // Even after owner approval, the app has not processed anything, so past-tense
  // "processed/refunded" claims stay blocked. Approval itself may be mentioned.
  if (status === "approved") return hits.filter((h) => !/approved/i.test(h));
  return hits;
}
