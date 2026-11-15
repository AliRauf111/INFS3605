import "server-only";
import { db } from "@/lib/db/supabase";
import type { Colour, DraftKind, RequestStatus, RequestType, TriState } from "@/lib/domain/types";
import type { DecisionResult } from "@/lib/engine/evaluate";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import type { PolicyDefinition, PolicySnapshot } from "@/lib/engine/policy";
import type { ConfirmedFacts } from "@/lib/validation/facts";
import { activityFor, type ActivityRow } from "@/lib/agent/activity";
import { computeCoverage, suggestRules, type CoverageRequest } from "@/lib/coverage/logic";

// Read-only queries used by server-rendered pages. Pages never query Supabase from the
// browser; they call these functions on the server.

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  return res.data as T;
}

export type RequestRow = {
  id: string;
  request_type: RequestType;
  money_involved: TriState | null;
  amount_cents: number | null;
  complaint_status: TriState | null;
  welfare_status: TriState | null;
  reference_id: string | null;
  booking_id: string | null;
  context: string;
  confirmed_facts: ConfirmedFacts;
  decision: Colour;
  decision_reason: string;
  matched_rule_id: string;
  policy_version: string;
  next_step: string;
  status: RequestStatus;
  intake_method: string;
  data_label: string;
  current_decision_id: string | null;
  decision_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

const REQUEST_COLUMNS =
  "id, request_type, money_involved, amount_cents, complaint_status, welfare_status, reference_id, booking_id, context, confirmed_facts, decision, decision_reason, matched_rule_id, policy_version, next_step, status, intake_method, data_label, current_decision_id, decision_count, created_at, updated_at, created_by";

// True when the database hasn't had the "remove from list" update yet (no hidden_at column).
function missingHiddenColumn(error: { message?: string; code?: string } | null): boolean {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /hidden_at/.test(error.message ?? "")));
}

// True when the database hasn't had the "archive" update yet (no archived_at column).
function missingArchivedColumn(error: { message?: string; code?: string } | null): boolean {
  return Boolean(error && /archived_at/.test(error.message ?? ""));
}

/** Which part of the list to show: the normal list, archived requests or removed requests. */
export type ListView = "active" | "archived" | "removed";

/**
 * Requests for the lists, newest first. The normal list leaves out requests that were
 * archived or removed. "archived" returns archived requests that weren't also removed,
 * and "removed" returns removed ones. If a database update hasn't been run yet, the
 * list works as it did before that update.
 */
export async function listRequests(opts: { status?: RequestStatus[]; limit?: number; view?: ListView } = {}): Promise<RequestRow[]> {
  const view = opts.view ?? "active";
  const build = (withHidden: boolean, withArchived: boolean) => {
    let q = db().from("requests").select(REQUEST_COLUMNS).order("created_at", { ascending: false }).limit(opts.limit ?? 100);
    if (opts.status?.length) q = q.in("status", opts.status);
    if (withHidden) q = view === "removed" ? q.not("hidden_at", "is", null) : q.is("hidden_at", null);
    if (withArchived && view !== "removed") q = view === "archived" ? q.not("archived_at", "is", null) : q.is("archived_at", null);
    return q;
  };
  let res = await build(true, true);
  if (missingArchivedColumn(res.error)) {
    if (view === "archived") return [];
    res = await build(true, false);
  }
  if (missingHiddenColumn(res.error)) {
    if (view !== "active") return [];
    return check(await build(false, false), "requests") as RequestRow[];
  }
  return check(res, "requests") as RequestRow[];
}

export type ListVisibility = { hiddenAt: string | null; hiddenBy: string | null; archivedAt: string | null } | "not_set_up";

/** Whether a request has been removed from the lists or archived. */
export async function requestVisibility(id: string): Promise<ListVisibility> {
  let res = await db().from("requests").select("hidden_at, hidden_by, archived_at").eq("id", id).maybeSingle();
  if (missingArchivedColumn(res.error)) {
    const r = await db().from("requests").select("hidden_at, hidden_by").eq("id", id).maybeSingle();
    if (missingHiddenColumn(r.error)) return "not_set_up";
    if (r.error) throw new Error(`Could not load request: ${r.error.message}`);
    return { hiddenAt: r.data?.hidden_at ?? null, hiddenBy: r.data?.hidden_by ?? null, archivedAt: null };
  }
  if (missingHiddenColumn(res.error)) return "not_set_up";
  if (res.error) throw new Error(`Could not load request: ${res.error.message}`);
  const data = res.data as { hidden_at: string | null; hidden_by: string | null; archived_at: string | null } | null;
  return { hiddenAt: data?.hidden_at ?? null, hiddenBy: data?.hidden_by ?? null, archivedAt: data?.archived_at ?? null };
}

export async function userNames(): Promise<Map<string, string>> {
  const rows = check(await db().from("app_users").select("id, display_name, role"), "users") as Array<{ id: string; display_name: string; role: string }>;
  return new Map(rows.map((r) => [r.id, `${r.display_name} (${r.role})`]));
}

export type DecisionRow = {
  id: string;
  sequence: number;
  colour: Colour;
  matched_rule_id: string;
  policy_version: string;
  policy_version_id: string | null;
  policy_snapshot: PolicySnapshot | null;
  facts: ConfirmedFacts;
  result: DecisionResult;
  input_hash: string;
  engine_version: string;
  reason: string;
  created_by: string | null;
  created_at: string;
  evidence: EvidenceSnapshot | null;
};

export type EventRow = {
  id: string;
  event_type: string;
  actor_id: string | null;
  actor_role: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string;
  created_at: string;
};

export type DraftRow = { kind: DraftKind; body: string; generated_by: string; updated_at: string };

export async function getRequestDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const request = check(await db().from("requests").select(REQUEST_COLUMNS).eq("id", id).maybeSingle(), "request") as RequestRow | null;
  if (!request) return null;
  const [decisions, evidence, events, drafts, activity, names] = await Promise.all([
    db().from("decisions").select("id, sequence, colour, matched_rule_id, policy_version, policy_version_id, policy_snapshot, facts, result, input_hash, engine_version, reason, created_by, created_at").eq("request_id", id).order("sequence"),
    db().from("evidence_snapshots").select("decision_id, records").eq("request_id", id),
    db().from("request_events").select("id, event_type, actor_id, actor_role, from_status, to_status, note, created_at").eq("request_id", id).order("created_at"),
    db().from("drafts").select("kind, body, generated_by, updated_at").eq("request_id", id),
    activityFor({ requestId: id }),
    userNames(),
  ]);
  const evidenceBy = new Map(((check(evidence, "evidence") ?? []) as Array<{ decision_id: string; records: EvidenceSnapshot }>).map((e) => [e.decision_id, e.records]));
  const decisionRows = ((check(decisions, "decisions") ?? []) as Omit<DecisionRow, "evidence">[]).map((d) => ({ ...d, evidence: evidenceBy.get(d.id) ?? null }));
  return {
    request,
    decisions: decisionRows as DecisionRow[],
    current: decisionRows.find((d) => d.id === request.current_decision_id) as DecisionRow | undefined,
    events: (check(events, "events") ?? []) as EventRow[],
    drafts: (check(drafts, "drafts") ?? []) as DraftRow[],
    activity: activity as ActivityRow[],
    names,
  };
}

export async function ownerQueue() {
  const rows = await listRequests({ status: ["awaiting_owner", "review_required", "more_info_requested"], limit: 200 });
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? ((check(await db().from("request_events").select("request_id, event_type, note, created_at, actor_role").in("request_id", ids).order("created_at"), "events") ?? []) as Array<EventRow & { request_id: string }>)
    : [];
  const drafts = ids.length
    ? ((check(await db().from("drafts").select("request_id, kind, body").in("request_id", ids), "drafts") ?? []) as Array<{ request_id: string; kind: string; body: string }>)
    : [];
  const priority = (r: RequestRow) =>
    (r.welfare_status === "yes" ? 0 : r.complaint_status === "yes" ? 1 : r.decision === "red" ? 2 : 3) * 10 + (r.status === "awaiting_owner" ? 0 : 1);
  return rows
    .map((r) => ({
      request: r,
      priority: priority(r),
      events: events.filter((e) => e.request_id === r.id),
      summary: events.filter((e) => e.request_id === r.id && e.event_type === "sent_to_owner").at(-1)?.note ?? null,
      drafts: drafts.filter((d) => d.request_id === r.id),
    }))
    .sort((a, b) => a.priority - b.priority || a.request.created_at.localeCompare(b.request.created_at));
}

export async function knowledgeHub() {
  const [families, tutors, bookings, payments, slots, articles] = await Promise.all([
    db().from("families").select("id, parent_name, student_name, data_label").order("id"),
    db().from("tutors").select("id, name, subjects, data_label").order("id"),
    db().from("bookings").select("id, family_id, tutor_id, subject, lessons_purchased, lessons_used, price_cents, status, data_label, source_system, last_synced_at").order("id"),
    db().from("payments").select("id, booking_id, invoice_ref, amount_cents, status, paid_at, due_date, method, data_label, source_system, last_synced_at").order("id"),
    db().from("tutor_availability").select("id, tutor_id, starts_at, ends_at, status, data_label, source_system, last_synced_at").order("starts_at"),
    db().from("knowledge_articles").select("id, title, category, body, owner_approved, version, data_label, updated_at").order("id"),
  ]);
  return {
    families: check(families, "families") as Array<{ id: string; parent_name: string; student_name: string; data_label: string }>,
    tutors: check(tutors, "tutors") as Array<{ id: string; name: string; subjects: string[]; data_label: string }>,
    bookings: check(bookings, "bookings") as Array<Record<string, any>>,
    payments: check(payments, "payments") as Array<Record<string, any>>,
    slots: check(slots, "availability") as Array<Record<string, any>>,
    articles: check(articles, "articles") as Array<{ id: string; title: string; category: string; body: string; owner_approved: boolean; version: number; data_label: string; updated_at: string }>,
  };
}

export type PolicyVersionRow = {
  id: string;
  category: string;
  version: number;
  status: "draft" | "active" | "archived";
  definition: PolicyDefinition;
  change_note: string;
  source: string;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  activated_by: string | null;
};

export async function listPolicyVersions(): Promise<PolicyVersionRow[]> {
  return check(
    await db().from("policy_versions").select("id, category, version, status, definition, change_note, source, created_at, activated_at, archived_at, created_by, activated_by").order("category").order("version", { ascending: false }),
    "policies",
  ) as PolicyVersionRow[];
}

export async function getPolicyVersion(id: string): Promise<PolicyVersionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return check(
    await db().from("policy_versions").select("id, category, version, status, definition, change_note, source, created_at, activated_at, archived_at, created_by, activated_by").eq("id", id).maybeSingle(),
    "policy",
  ) as PolicyVersionRow | null;
}

export async function coverageData() {
  const [requests, decisions, approvals, suggestions, policies] = await Promise.all([
    db().from("requests").select("id, request_type, decision, matched_rule_id, status, amount_cents, complaint_status, welfare_status, confirmed_facts, created_at, current_decision_id").limit(2000),
    db().from("decisions").select("id, result").limit(5000),
    db().from("request_events").select("request_id").eq("event_type", "owner_approved").limit(5000),
    db().from("rule_suggestions").select("id, category, summary, based_on_request_ids, status, generated_by, draft_policy_version_id, created_at").order("created_at", { ascending: false }),
    db().from("policy_versions").select("category, definition").eq("status", "active"),
  ]);
  const missingBy = new Map(((check(decisions, "decisions") ?? []) as Array<{ id: string; result: DecisionResult }>).map((d) => [d.id, d.result?.missing ?? []]));
  const approved = new Set(((check(approvals, "approvals") ?? []) as Array<{ request_id: string }>).map((a) => a.request_id));
  const rows: CoverageRequest[] = ((check(requests, "requests") ?? []) as Array<Record<string, any>>).map((r) => ({
    ...(r as CoverageRequest),
    missing: missingBy.get(r.current_decision_id) ?? [],
    ownerApproved: approved.has(r.id),
  }));
  const active = Object.fromEntries(((check(policies, "policies") ?? []) as Array<{ category: string; definition: PolicyDefinition }>).map((p) => [p.category, p.definition]));
  return {
    rows,
    metrics: computeCoverage(rows),
    candidates: suggestRules(rows, active),
    suggestions: (check(suggestions, "suggestions") ?? []) as Array<{ id: string; category: string; summary: string; based_on_request_ids: string[]; status: string; generated_by: string; draft_policy_version_id: string | null; created_at: string }>,
  };
}
