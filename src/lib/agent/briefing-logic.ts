import { formatAud } from "@/lib/domain/money";
import { tr } from "@/lib/i18n/reply";
import { type Colour, type RequestStatus, type RequestType, type Role, type TriState } from "@/lib/domain/types";

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
  amber: "Yellow: Owner Approves or Details Needed",
  green: "Green: Within the Rules",
};

/** The colour section's title in the reader's language. COLOUR_TITLES keeps the English. */
export const colourTitle = (c: Colour): string => tr(`reply.brief.colour.${c}`);

/** A bucket's title for this role, in the reader's language. */
export const bucketTitle = (key: BucketKey, role: Role): string => tr(`reply.brief.bucket.${key}.${role}`);

export const orderingNote = (): string => tr("reply.brief.ordering");

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
  const key = (["welfare", "complaint", "unconfirmed"] as const)[tier];
  return key ? tr(`reply.brief.tier.${key}`) : null;
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
  if (mins < 1) return tr("reply.brief.wait.underMinute");
  if (mins < 60) return tr("reply.brief.wait.minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 48) return tr("reply.brief.wait.hours", { count: hours });
  const days = Math.floor(hours / 24);
  return tr("reply.brief.wait.days", { count: days });
}

export function describeRequest(r: Pick<BriefingRow, "request_type" | "amount_cents" | "reference_id" | "booking_id" | "confirmed_facts">): string {
  const days = r.confirmed_facts?.extensionDays;
  const what = tr("reply.brief.what", {
    type: tr(`domain.requestType.${r.request_type}`),
    amount: r.amount_cents !== null ? tr("reply.prop.ofAmount", { amount: formatAud(r.amount_cents) }) : "",
    days: days ? tr("reply.prop.extraDays", { count: days }) : "",
  });
  const ref = r.booking_id && r.reference_id && r.booking_id !== r.reference_id ? `${r.reference_id} (${r.booking_id})` : r.reference_id ?? r.booking_id ?? tr("reply.brief.noBookingRef");
  return tr("reply.brief.describe", { what, ref });
}

export type NextStep = { label: string; command: "review" | "followup" };

const REVIEW = () => ({ label: tr("reply.brief.next.review"), command: "review" as const });
const FOLLOWUP = () => ({ label: tr("reply.brief.next.followup"), command: "followup" as const });
const OUTCOME = () => ({ label: tr("reply.brief.next.outcome"), command: "review" as const });

/** Why this needs attention now, and the most useful next step for this person. */
export function attentionFor(status: RequestStatus, role: Role): { why: string; next: NextStep } {
  switch (status) {
    case "awaiting_owner":
      return { why: tr(role === "owner" ? "reply.brief.why.awaitingOwner" : "reply.brief.why.awaitingAdmin"), next: REVIEW() };
    case "review_required":
      return { why: tr(role === "owner" ? "reply.brief.why.reviewOwner" : "reply.brief.why.reviewAdmin"), next: REVIEW() };
    case "needs_clarification":
      return { why: tr("reply.brief.why.clarify"), next: FOLLOWUP() };
    case "more_info_requested":
      return { why: tr("reply.brief.why.moreInfo"), next: FOLLOWUP() };
    case "approved":
    case "declined":
      return { why: tr("reply.brief.why.decided", { status: tr(`domain.status.${status}`) }), next: OUTCOME() };
    case "ready":
      return { why: tr("reply.brief.why.ready"), next: OUTCOME() };
    default:
      return { why: tr("reply.brief.why.finished"), next: REVIEW() };
  }
}

/** A short handle for telling apart requests that share a booking reference. */
export function shortId(id: string): string {
  return `#${id.replace(/-/g, "").slice(-6)}`;
}
