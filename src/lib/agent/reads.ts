import "server-only";
import { db } from "@/lib/db/supabase";
import type { SessionUser } from "@/lib/auth/session";
import { getActivePolicy, liveRecordsForBooking } from "@/lib/context/retrieve";
import type { Colour, DraftKind, RequestStatus, RequestType, TriState } from "@/lib/domain/types";
import type { DecisionResult } from "@/lib/engine/evaluate";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import type { PolicySnapshot } from "@/lib/engine/policy";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import { BUCKETS, sortByPriority, waitingSince, type BriefingRow, type BucketKey } from "./briefing-logic";
import type { Procedure } from "./review-logic";

// Compass's read tools. Each one is an ordinary server function with its own query, so
// Compass never scrapes a rendered page. They return only what a task needs. Both roles
// may read requests today; the presenting code hides welfare narratives from admins.

export class SourceUnavailable extends Error {}

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new SourceUnavailable(`Could not read ${what}: ${res.error.message}`);
  return res.data as T;
}

// Older databases may not have the archive and remove columns yet. Look once a minute.
let columnsCache: { at: number; hidden: boolean; archived: boolean } | null = null;
async function listColumns(): Promise<{ hidden: boolean; archived: boolean }> {
  if (columnsCache && Date.now() - columnsCache.at < 60_000) return columnsCache;
  const [h, a] = await Promise.all([
    db().from("requests").select("hidden_at").limit(1),
    db().from("requests").select("archived_at").limit(1),
  ]);
  columnsCache = { at: Date.now(), hidden: !h.error, archived: !a.error };
  return columnsCache;
}

// Query builders are "thenable", so this must stay synchronous: awaiting one runs it.
function activeOnly<Q extends { is: (c: string, v: null) => Q }>(q: Q, cols: { hidden: boolean; archived: boolean }): Q {
  let out = q;
  if (cols.hidden) out = out.is("hidden_at", null);
  if (cols.archived) out = out.is("archived_at", null);
  return out;
}

const REF = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

export type RequestSummary = BriefingRow & { context: string; decision_reason: string; matched_rule_id: string; policy_version: string };

const SUMMARY_COLUMNS =
  "id, request_type, status, decision, amount_cents, reference_id, booking_id, welfare_status, complaint_status, confirmed_facts, created_at, updated_at, context, decision_reason, matched_rule_id, policy_version";

export type RequestFilter = {
  statuses?: RequestStatus[];
  type?: RequestType;
  colour?: Colour;
  reference?: string;
  page?: number;
  pageSize?: number;
};

/** Tool: search and filter active requests. The total is an exact count of every match. */
export async function searchRequests(filter: RequestFilter): Promise<{ rows: RequestSummary[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 10));
  let q = db().from("requests").select(SUMMARY_COLUMNS, { count: "exact" }).order("created_at", { ascending: false });
  if (filter.statuses?.length) q = q.in("status", filter.statuses);
  if (filter.type) q = q.eq("request_type", filter.type);
  if (filter.colour) q = q.eq("decision", filter.colour);
  if (filter.reference) {
    const ref = filter.reference.toUpperCase();
    if (!REF.test(ref)) return { rows: [], total: 0, page, pageSize };
    q = q.or(`reference_id.eq.${ref},booking_id.eq.${ref}`);
  }
  q = activeOnly(q, await listColumns());
  const res = await q.range((page - 1) * pageSize, page * pageSize - 1);
  const rows = check(res, "requests") as RequestSummary[];
  return { rows, total: res.count ?? rows.length, page, pageSize };
}

/** Tool: every active request whose reference or booking matches. References repeat, so the caller must let the person choose. */
export async function requestsForReference(reference: string): Promise<RequestSummary[]> {
  const out = await searchRequests({ reference, pageSize: 20 });
  return out.rows;
}

// ---------------------------------------------------------------------------
// Briefing counts and items

export type BriefingSection = {
  key: BucketKey;
  count: number;
  items: Array<RequestSummary & { waitingSince: string }>;
  page: number;
  pageSize: number;
  /** False if the ordering could only use the first ORDER_LIMIT rows of a very large queue. */
  orderedAll: boolean;
};

const ORDER_LIMIT = 2000;

async function countStatuses(statuses: RequestStatus[]): Promise<number> {
  const cols = await listColumns();
  const res = await activeOnly(db().from("requests").select("id", { count: "exact", head: true }).in("status", statuses), cols);
  if (res.error) throw new SourceUnavailable(`Could not count requests: ${res.error.message}`);
  return res.count ?? 0;
}

async function bucketRows(statuses: RequestStatus[]): Promise<RequestSummary[]> {
  const rows: RequestSummary[] = [];
  const cols = await listColumns();
  for (let from = 0; from < ORDER_LIMIT; from += 500) {
    const q = activeOnly(db().from("requests").select(SUMMARY_COLUMNS).in("status", statuses).order("created_at").order("id"), cols);
    const batch = check(await q.range(from, from + 499), "requests") as RequestSummary[];
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  return rows;
}

async function statusEvents(ids: string[]): Promise<Map<string, Array<{ to_status: string | null; created_at: string }>>> {
  const out = new Map<string, Array<{ to_status: string | null; created_at: string }>>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = check(await db().from("request_events").select("request_id, to_status, created_at").in("request_id", chunk), "request history") as Array<{ request_id: string; to_status: string | null; created_at: string }>;
    for (const r of rows) out.set(r.request_id, [...(out.get(r.request_id) ?? []), r]);
  }
  return out;
}

/**
 * Tool: briefing counts and the first page of each section. Counts come from exact
 * count queries over every active request, never from a capped list.
 */
export async function briefingData(opts: { only?: BucketKey; page?: number; pageSize?: number } = {}): Promise<BriefingSection[]> {
  const pageSize = Math.min(20, Math.max(1, opts.pageSize ?? (opts.only ? 10 : 5)));
  const buckets = BUCKETS.filter((b) => !opts.only || b.key === opts.only);
  return Promise.all(
    buckets.map(async (b) => {
      const page = opts.only ? Math.max(1, opts.page ?? 1) : 1;
      const count = await countStatuses(b.statuses);
      if (count === 0) return { key: b.key, count, items: [], page, pageSize, orderedAll: true };
      const rows = await bucketRows(b.statuses);
      const events = await statusEvents(rows.map((r) => r.id));
      const sorted = sortByPriority(rows.map((r) => ({ ...r, waitingSince: waitingSince(r, events.get(r.id) ?? []) })));
      return { key: b.key, count, items: sorted.slice((page - 1) * pageSize, page * pageSize), page, pageSize, orderedAll: rows.length >= count };
    }),
  );
}

// ---------------------------------------------------------------------------
// One request with its history and evidence

export type RequestRecord = RequestSummary & {
  money_involved: TriState | null;
  current_decision_id: string | null;
  policy_version_id: string | null;
  decision_count: number;
  next_step: string;
  created_by: string | null;
  hidden_at?: string | null;
  archived_at?: string | null;
  category_code?: string | null;
  course_id?: string | null;
  year_level?: number | null;
  confirmed_facts: ConfirmedFacts;
};

export type RequestBundle = {
  request: RequestRecord;
  decision: { id: string; sequence: number; result: DecisionResult; policy_snapshot: PolicySnapshot | null; created_at: string } | null;
  evidence: EvidenceSnapshot | null;
  events: Array<{ event_type: string; actor_role: string | null; actor_name: string | null; from_status: string | null; to_status: string | null; note: string; created_at: string }>;
  drafts: Array<{ kind: DraftKind; body: string; generated_by: string; updated_at: string }>;
  live: { booking: Awaited<ReturnType<typeof liveRecordsForBooking>>["booking"]; payments: Awaited<ReturnType<typeof liveRecordsForBooking>>["payments"] } | null;
  liveError: string | null;
  activePolicy: PolicySnapshot | null;
  procedures: Procedure[];
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tool: one request with its decision, evidence, history, drafts, live records, policy and procedures. */
export async function requestBundle(id: string): Promise<RequestBundle | null> {
  if (!UUID.test(id)) return null;
  const request = check(await db().from("requests").select("*").eq("id", id).maybeSingle(), "the request") as RequestRecord | null;
  if (!request) return null;
  const [decision, evidence, events, drafts, names, procedures] = await Promise.all([
    request.current_decision_id
      ? db().from("decisions").select("id, sequence, result, policy_snapshot, created_at").eq("id", request.current_decision_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    request.current_decision_id
      ? db().from("evidence_snapshots").select("records").eq("decision_id", request.current_decision_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db().from("request_events").select("event_type, actor_id, actor_role, from_status, to_status, note, created_at").eq("request_id", id).order("created_at"),
    db().from("drafts").select("kind, body, generated_by, updated_at").eq("request_id", id),
    db().from("app_users").select("id, display_name"),
    approvedProcedures(),
  ]);
  const nameBy = new Map(((check(names, "users") ?? []) as Array<{ id: string; display_name: string }>).map((u) => [u.id, u.display_name]));
  let live: RequestBundle["live"] = null;
  let liveError: string | null = null;
  if (request.booking_id) {
    try {
      live = await liveRecordsForBooking(request.booking_id);
    } catch (e) {
      liveError = e instanceof Error ? e.message : "The booking records could not be read.";
    }
  }
  const activePolicy = request.request_type === "other" ? null : await getActivePolicy(request.request_type);
  return {
    request,
    decision: check(decision, "the decision") as RequestBundle["decision"],
    evidence: ((check(evidence, "the evidence") as { records: EvidenceSnapshot } | null)?.records ?? null),
    events: ((check(events, "the request history") ?? []) as Array<{ event_type: string; actor_id: string | null; actor_role: string | null; from_status: string | null; to_status: string | null; note: string; created_at: string }>).map((e) => ({
      event_type: e.event_type, actor_role: e.actor_role, actor_name: e.actor_id ? nameBy.get(e.actor_id) ?? null : null,
      from_status: e.from_status, to_status: e.to_status, note: e.note, created_at: e.created_at,
    })),
    drafts: (check(drafts, "drafts") ?? []) as RequestBundle["drafts"],
    live,
    liveError,
    activePolicy,
    procedures,
  };
}

/** Tool: owner-approved procedures with their versions. */
export async function approvedProcedures(): Promise<Procedure[]> {
  return (check(
    await db().from("knowledge_articles").select("id, title, category, body, version, owner_approved").eq("owner_approved", true).order("id"),
    "procedures",
  ) ?? []) as Procedure[];
}

/** Tool: the active policy for each category. */
export async function activePolicies(): Promise<PolicySnapshot[]> {
  const out = await Promise.all((["refund", "lesson_change", "payment_extension"] as const).map((c) => getActivePolicy(c)));
  return out.filter((p): p is PolicySnapshot => Boolean(p));
}

/** Who can see a welfare narrative in Compass. The owner handles welfare personally. */
export function canSeeWelfareDetail(user: SessionUser): boolean {
  return user.role === "owner";
}

