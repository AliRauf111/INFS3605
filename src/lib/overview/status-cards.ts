import { REQUEST_TYPE_LABELS, STATUS_LABELS, type Colour, type RequestStatus, type RequestType, type Role } from "@/lib/domain/types";
import { workflowFor } from "@/lib/workflow/next-step";

// The Overview's three status cards and its "Over to You" list. The cards group requests by
// where they are in the workflow, coloured like the traffic lights: red for an owner
// decision, yellow for missing information, green for ready for the admin team. The rule
// result saved with each request is not changed here. Pure, so it can be tested.

export const STATUS_GROUPS = ["owner", "info", "ready"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export const GROUP_STATUSES: Record<StatusGroup, RequestStatus[]> = {
  owner: ["review_required", "awaiting_owner"],
  info: ["needs_clarification", "more_info_requested"],
  ready: ["ready", "approved"],
};

export const GROUP_COLOUR: Record<StatusGroup, Colour> = { owner: "red", info: "amber", ready: "green" };
export const GROUP_LABEL: Record<StatusGroup, string> = {
  owner: "Owner Review Required",
  info: "More Information Needed",
  ready: "Ready for Admin",
};

export function groupFromParam(v: string | undefined | null): StatusGroup | null {
  return STATUS_GROUPS.includes(v as StatusGroup) ? (v as StatusGroup) : null;
}

export function groupOf(status: RequestStatus): StatusGroup | null {
  return STATUS_GROUPS.find((g) => GROUP_STATUSES[g].includes(status)) ?? null;
}

/** The short line under each count, worded for who is signed in. */
export function groupText(group: StatusGroup, role: Role): string {
  if (group === "owner") return role === "owner" ? "Your judgement is needed" : "Waiting on the owner's decision";
  if (group === "info") return "A few details to clarify";
  return role === "owner" ? "With the admin team to confirm" : "Ready to review and confirm";
}

/** Two digits, as on the cards: 2 becomes "02". Larger numbers are shown in full. */
export function twoDigits(n: number): string {
  return n < 10 ? `0${Math.max(0, n)}` : String(n);
}

export function countGroups(rows: Array<{ status: RequestStatus }>): Record<StatusGroup, number> {
  const out: Record<StatusGroup, number> = { owner: 0, info: 0, ready: 0 };
  for (const r of rows) {
    const g = groupOf(r.status);
    if (g) out[g] += 1;
  }
  return out;
}

export type CardRow = {
  id: string;
  request_type: RequestType;
  status: RequestStatus;
  decision: Colour;
  amount_cents: number | null;
  reference_id: string | null;
  created_at: string;
  updated_at?: string | null;
  missing: number;
  reviewStartedAt?: string | null;
  welfare: boolean;
  complaint: boolean;
  extensionDays?: number | null;
  context?: string | null;
};

/** Requests the signed-in person can take the next step on now, most urgent first. */
export function overToYou<T extends CardRow>(rows: T[], role: Role): T[] {
  const rank = (r: CardRow) => (r.welfare ? 0 : r.complaint ? 1 : 2) * 10 + (r.decision === "red" ? 0 : r.decision === "amber" ? 1 : 2);
  return rows
    .filter((r) => {
      const w = workflowFor({ role, status: r.status, missing: r.missing, reviewStartedAt: r.reviewStartedAt ?? null, colour: r.decision, welfare: r.welfare });
      return Boolean(w.primary && !w.primary.disabled);
    })
    .sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
}

const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

/** A heading for a request card, built from the request's own facts. */
export function cardTitle(r: CardRow): string {
  switch (r.request_type) {
    case "refund":
      return r.amount_cents ? `A ${money(r.amount_cents)} refund` : "A refund request";
    case "payment_extension":
      return r.extensionDays ? `${r.extensionDays} more days to pay` : "More time to pay";
    case "lesson_change":
      return "Move a lesson";
    default:
      return REQUEST_TYPE_LABELS[r.request_type] ?? "A request";
  }
}

/**
 * One short line under the heading. Welfare wording never appears here: the owner reads it
 * on the request itself, so a flagged request only says that it was flagged.
 */
export function cardLine(r: CardRow, max = 96): string {
  if (r.welfare) return "A welfare concern was flagged. The owner handles this personally.";
  const text = (r.context ?? "").replace(/\s+/g, " ").trim();
  if (!text) return `${REQUEST_TYPE_LABELS[r.request_type]}${r.reference_id ? ` for ${r.reference_id}` : ""}.`;
  return text.length > max ? `${text.slice(0, max - 1).replace(/[\s,.;:]+\S*$/, "")}…` : text;
}

export function statusLabel(s: RequestStatus): string {
  return STATUS_LABELS[s] ?? s;
}

/** Pastel tile colour for each request type, as in the Studio design. */
export const TILE_COLOUR: Record<RequestType, "lavender" | "blue" | "rose"> = {
  payment_extension: "lavender",
  refund: "blue",
  lesson_change: "rose",
  other: "lavender",
};

/** The Studio design's traffic signal key for each group. */
export const GROUP_SIGNAL: Record<StatusGroup, "red" | "amber" | "green"> = { owner: "red", info: "amber", ready: "green" };

/** What an empty, filtered "Over to You" says. */
export const GROUP_EMPTY: Record<StatusGroup, string> = {
  owner: "No requests need owner review.",
  info: "No requests are waiting for more information.",
  ready: "No requests are ready for admin right now.",
};

/**
 * Every request still in one of the three groups, as on the status cards: owner decisions
 * first, then missing information, then ready for admin. Welfare and complaints lead
 * within a group, then the oldest.
 */
export function pendingRequests<T extends CardRow>(rows: T[]): T[] {
  const rank = (r: CardRow) => STATUS_GROUPS.indexOf(groupOf(r.status)!) * 10 + (r.welfare ? 0 : r.complaint ? 1 : 2);
  return rows.filter((r) => groupOf(r.status) !== null).sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at));
}
