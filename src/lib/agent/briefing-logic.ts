import { formatAud } from "@/lib/domain/money";
import { REQUEST_TYPE_LABELS, STATUS_LABELS, type Colour, type RequestStatus, type RequestType, type Role, type TriState } from "@/lib/domain/types";

// Pure logic for the owner briefing: which statuses count as unfinished work, how items
// are ordered and how each one is described. The order comes from the same escalation
// rules the engine and Approval Alley use, so it can be explained in one sentence.

export const BUCKET_KEYS = ["owner_decision", "send_to_owner", "clarification", "pending_outcome", "ready"] as const;
export type BucketKey = (typeof BUCKET_KEYS)[number];

export type Bucket = {
  key: BucketKey;
  title: Record<Role, string>;
  statuses: RequestStatus[];
};

/** Every unfinished status appears in exactly one bucket. Closed requests are finished. */
export const BUCKETS: Bucket[] = [
  { key: "owner_decision", title: { owner: "Waiting for Your Decision", admin: "Waiting for the Owner" }, statuses: ["awaiting_owner"] },
  { key: "send_to_owner", title: { owner: "Requires Your Review, Not Yet Sent", admin: "Owner Review Required" }, statuses: ["review_required"] },
  { key: "clarification", title: { owner: "Needs Clarification", admin: "Needs Clarification" }, statuses: ["needs_clarification", "more_info_requested"] },
  { key: "pending_outcome", title: { owner: "Decided, Awaiting Outcome", admin: "Decided, Awaiting Outcome" }, statuses: ["approved", "declined"] },
  { key: "ready", title: { owner: "Ready for Admin", admin: "Ready for Admin" }, statuses: ["ready"] },
];

export const COLOURS = ["red", "amber", "green"] as const;

/** Every unfinished status. Closed requests are finished. */
export const UNFINISHED: RequestStatus[] = BUCKETS.flatMap((b) => b.statuses);

export const COLOUR_TITLES: Record<Colour, string> = {
  red: "Red: Owner Decides",
  amber: "Amber: Owner Approves or Details Needed",
  green: "Green: Within the Rules",
};

export const ORDERING_NOTE =
  "Red first, then amber, then green. Within each colour, welfare concerns come first, then complaints, then unconfirmed welfare or complaint answers, then the longest wait.";

export type BriefingRow = {
  id: string;
  request_type: RequestType;
  status: RequestStatus;
  decision: Colour;
  amount_cents: number | null;
  reference_id: string | null;
  booking_id: string | null;
  welfare_status: TriState | null;
  complaint_status: TriState | null;
  confirmed_facts: { extensionDays?: number | null } | null;
  created_at: string;
  updated_at: string;
};

export function bucketFor(status: RequestStatus): BucketKey | null {
  return BUCKETS.find((b) => b.statuses.includes(status))?.key ?? null;
}

/** Lower is more urgent. Welfare beats complaints, which beat everything else. */
export function priorityTier(r: Pick<BriefingRow, "welfare_status" | "complaint_status" | "decision">): number {
  if (r.welfare_status === "yes") return 0;
  if (r.complaint_status === "yes") return 1;
  if (r.welfare_status === "unsure" || r.complaint_status === "unsure") return 2;
  return r.decision === "red" ? 3 : r.decision === "amber" ? 4 : 5;
}

export function tierReason(tier: number): string | null {
  return ["Welfare concern", "Complaint", "Welfare or complaint not confirmed", null, null, null][tier] ?? null;
}

const colourRank = (c: Colour) => COLOURS.indexOf(c);

/** Sort: red, amber, green; then the most urgent tier; then the one waiting longest. */
export function sortByPriority<T extends BriefingRow & { waitingSince: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    colourRank(a.decision) - colourRank(b.decision) || priorityTier(a) - priorityTier(b) || a.waitingSince.localeCompare(b.waitingSince) || a.id.localeCompare(b.id));
}

/** When the request entered its current status: the latest event that moved it there. */
export function waitingSince(row: Pick<BriefingRow, "status" | "created_at" | "updated_at">, events: Array<{ to_status: string | null; created_at: string }>): string {
  const into = events.filter((e) => e.to_status === row.status).map((e) => e.created_at).sort();
  return into.at(-1) ?? row.updated_at ?? row.created_at;
}

export function formatWaiting(sinceIso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(sinceIso).getTime());
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function describeRequest(r: Pick<BriefingRow, "request_type" | "amount_cents" | "reference_id" | "booking_id" | "confirmed_facts">): string {
  const days = r.confirmed_facts?.extensionDays;
  const what = `${REQUEST_TYPE_LABELS[r.request_type]}${r.amount_cents !== null ? ` of ${formatAud(r.amount_cents)}` : ""}${days ? `, ${days} extra days` : ""}`;
  const ref = r.booking_id && r.reference_id && r.booking_id !== r.reference_id ? `${r.reference_id} (${r.booking_id})` : r.reference_id ?? r.booking_id ?? "no booking reference";
  return `${what} for ${ref}`;
}

export type NextStep = { label: "Review Request" | "Prepare Follow-up" | "Record Outcome"; command: "review" | "followup" };

/** Why this needs attention now, and the most useful next step for this person. */
export function attentionFor(status: RequestStatus, role: Role): { why: string; next: NextStep } {
  switch (status) {
    case "awaiting_owner":
      return role === "owner"
        ? { why: "Your decision is needed before the admin team can act.", next: { label: "Review Request", command: "review" } }
        : { why: "Waiting for the owner's decision. There is nothing for the admin team to do yet.", next: { label: "Review Request", command: "review" } };
    case "review_required":
      return role === "owner"
        ? { why: "The rules say you need to review this. The admin team hasn't sent it yet, but you can start the review now.", next: { label: "Review Request", command: "review" } }
        : { why: "The rules say the owner must review this, but it has not been sent to the owner yet.", next: { label: "Review Request", command: "review" } };
    case "needs_clarification":
      return { why: "Facts are missing or conflicting, so no rule can be applied yet.", next: { label: "Prepare Follow-up", command: "followup" } };
    case "more_info_requested":
      return { why: "The owner asked for more information before deciding.", next: { label: "Prepare Follow-up", command: "followup" } };
    case "approved":
    case "declined":
      return { why: `${STATUS_LABELS[status]}. The admin team still needs to act and record the outcome.`, next: { label: "Record Outcome", command: "review" } };
    case "ready":
      return { why: "Within the owner's rules. The admin team can act and then record the outcome.", next: { label: "Record Outcome", command: "review" } };
    default:
      return { why: "Finished.", next: { label: "Review Request", command: "review" } };
  }
}

/** A short handle for telling apart requests that share a booking reference. */
export function shortId(id: string): string {
  return `#${id.replace(/-/g, "").slice(-6)}`;
}
