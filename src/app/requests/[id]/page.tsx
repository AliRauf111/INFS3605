import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { getRequestDetail, requestVisibility, type ListVisibility } from "@/lib/data/queries";
import { db } from "@/lib/db/supabase";
import { aiConfigured } from "@/lib/ai/client";
import { formatAud } from "@/lib/domain/money";
import {
  ACTION_LABELS,
  REQUEST_TYPE_LABELS,
  TRI_STATE_LABELS,
  type DraftKind,
  type TriState,
} from "@/lib/domain/types";
import { describeRange, policyVersionLabel } from "@/lib/engine/policy";
import { ActivityPanel } from "@/components/ActivityPanel";
import { ColourBadge, DataBadge, LoadError, StatusBadge, formatDateTime } from "@/components/ui";
import { friendlyTime, nextStep, progressHeading, requestProgress, ruleHeading, whatHappensNext } from "@/lib/domain/progress";
import { RequestActions } from "./RequestActions";
import { DraftsEditor } from "./DraftsEditor";
import { RemoveFromList } from "./RemoveFromList";
import { RequestClass } from "./RequestClass";
import { classesForRequests, savedRequestClass } from "@/lib/data/catalogue";
import { removalNeedsOwner } from "@/lib/domain/progress";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request" };

const COLOUR_WORD = { green: "Green", amber: "Amber", red: "Red" } as const;
const tri = (v: TriState | null) => (v ? TRI_STATE_LABELS[v] : "Not answered");
const EVENT_TEXT: Record<string, string> = {
  created: "Created",
  reevaluated: "Facts updated and re-checked",
  sent_to_owner: "Sent to the owner",
  owner_approved: "Owner approved",
  owner_declined: "Owner declined",
  owner_requested_info: "Owner asked for more information",
  admin_replied: "Admin replied with updated facts",
  admin_recorded: "Admin recorded an action",
  closed: "Recorded and closed",
  removed_from_list: "Removed from the list",
  restored_to_list: "Put back in the list",
  archived: "Archived",
  unarchived: "Restored from the archive",
  class_changed: "Class changed",
};

const DRAFTS_FOR_ACTION: Partial<Record<string, DraftKind>> = {
  prepare_parent_response: "parent_response",
  prepare_tutor_message: "tutor_message",
  prepare_escalation_summary: "escalation_summary",
  prepare_reschedule_proposal: "reschedule_proposal",
  prepare_admin_checklist: "admin_checklist",
};

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const { saved } = await searchParams;
  let detail;
  let visibility: ListVisibility = "not_set_up";
  let savedClass: Awaited<ReturnType<typeof savedRequestClass>> = null;
  let bookingClass: Awaited<ReturnType<typeof classesForRequests>> = new Map();
  try {
    detail = await getRequestDetail(id);
    if (detail) {
      [visibility, savedClass] = await Promise.all([requestVisibility(id), savedRequestClass(id)]);
      if (!savedClass || savedClass === "not_set_up") bookingClass = await classesForRequests([detail.request]);
    }
  } catch (e) {
    return <LoadError error={e} />;
  }
  if (!detail) notFound();
  const { request: r, current, decisions, events, drafts, activity, names } = detail;
  const result = current?.result;
  const evidence = current?.evidence;
  const snapshot = current?.policy_snapshot;
  const rule = snapshot?.definition.rules.find((x) => x.id === (result?.candidateRuleId ?? r.matched_rule_id));
  const ownerEvent = [...events].reverse().find((e) => e.event_type.startsWith("owner_"));
  const kb = r.welfare_status === "yes" ? "KB-01" : r.complaint_status === "yes" ? "KB-04" : null;
  const article = kb ? (await db().from("knowledge_articles").select("id, title, body, owner_approved, version").eq("id", kb).maybeSingle()).data : null;
  const draftKinds = new Set<DraftKind>(["escalation_summary"]);
  for (const a of result?.permittedActions ?? []) {
    const k = DRAFTS_FOR_ACTION[a];
    if (k) draftKinds.add(k);
  }
  if (r.request_type === "lesson_change") draftKinds.add("reschedule_proposal");
  if (r.welfare_status === "yes") {
    draftKinds.clear();
    draftKinds.add("escalation_summary");
  }
  const escalationDraft = drafts.find((d) => d.kind === "escalation_summary")?.body ?? "";

  const steps = requestProgress(r.status, Boolean(ownerEvent) || events.some((e) => e.event_type === "sent_to_owner"));
  const heading = progressHeading(steps);
  const pending = nextStep(r.status).pending;
  const createdBy = r.created_by ? names.get(r.created_by) ?? "Unknown" : "Seed data";
  const ruleHref = snapshot ? `/rules/${snapshot.id}` : "/knowledge#rules";
  type Item = { key: string; at: string; order: number; dot: string; title: string; detail?: string; note?: string | null };
  const items: Item[] = [
    ...decisions.map((d) => ({
      key: `d-${d.id}`,
      at: d.created_at,
      order: 1,
      dot: d.colour,
      title: `Rule check returned ${COLOUR_WORD[d.colour]}`,
      detail: `${friendlyTime(d.created_at)} · matched ${d.matched_rule_id}`,
    })),
    ...events.map((e) => ({
      key: `e-${e.id}`,
      at: e.created_at,
      order: e.event_type === "created" ? 0 : 2,
      dot: e.event_type === "owner_declined" ? "red" : e.event_type === "owner_approved" || e.event_type === "closed" ? "green" : "navy",
      title: e.event_type === "created" ? `Request created by ${e.actor_id ? names.get(e.actor_id) ?? "unknown" : "seed data"}` : EVENT_TEXT[e.event_type] ?? e.event_type,
      detail: `${friendlyTime(e.created_at)}${e.event_type !== "created" && e.actor_id ? ` · ${names.get(e.actor_id) ?? e.actor_role}` : ""}`,
      note: e.event_type === "created" ? null : e.note,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.order - a.order);

  return (
    <div className="stack rq-page">
      {saved && <div className="notice success" role="status">Saved. This request and its decision are stored in the database.</div>}
      {visibility !== "not_set_up" && visibility.hiddenAt && (
        <div className="notice warning" role="status">
          Removed from the list {friendlyTime(visibility.hiddenAt).replace(/^[A-Z]/, (c) => c.toLowerCase())}
          {visibility.hiddenBy && names.get(visibility.hiddenBy) ? ` by ${names.get(visibility.hiddenBy)}` : ""}. It no longer shows on the dashboard, Requests or Approval Alley. Its full record is kept below.
        </div>
      )}
      {visibility !== "not_set_up" && visibility.archivedAt && !visibility.hiddenAt && (
        <div className="notice info" role="status">
          Archived {friendlyTime(visibility.archivedAt).replace(/^[A-Z]/, (c) => c.toLowerCase())}. It only shows under <Link href="/requests?archived=1">Archived requests</Link>, where you can restore it. Its decision and history haven&apos;t changed.
        </div>
      )}
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/requests">Requests</Link> <span aria-hidden="true">›</span> <span aria-current="page">{r.reference_id ?? "Request"}</span>
      </nav>

      <RequestActions
        requestId={r.id}
        status={r.status}
        role={user.role}
        colour={r.decision}
        currentDecisionId={r.current_decision_id}
        facts={r.confirmed_facts}
        escalationDraft={escalationDraft}
      >
        <p className="rq-kicker">{REQUEST_TYPE_LABELS[r.request_type]} · Created {friendlyTime(r.created_at).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase())}</p>
        <h1>{r.reference_id ?? REQUEST_TYPE_LABELS[r.request_type]}{r.amount_cents !== null && <span className="rq-amount"> · {formatAud(r.amount_cents)}</span>}</h1>
      </RequestActions>

      <section className="card rq-progress" aria-label="Progress">
        <div className="rq-progress-head">
          <h2>{heading.title}</h2>
          <span className="muted">{heading.aside}</span>
        </div>
        <ol className="stepper">
          {steps.map((s) => (
            <li key={s.label} className={`step ${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
              <span className="step-dot" aria-hidden="true">{s.state === "done" ? "✓" : ""}</span>
              <span className="step-label">{s.label}</span>
              {s.note && <span className="step-note">{s.note}</span>}
              <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (current step)" : s.state === "skipped" ? " (not needed)" : " (to do)"}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="rq-layout">
        <div className="stack">
          {ownerEvent && (
            <div className={`notice ${ownerEvent.event_type === "owner_approved" ? "success" : ownerEvent.event_type === "owner_declined" ? "error" : "warning"}`}>
              <p><strong>{EVENT_TEXT[ownerEvent.event_type]}</strong> on {formatDateTime(ownerEvent.created_at)}</p>
              <p>&ldquo;{ownerEvent.note}&rdquo;</p>
              {ownerEvent.event_type === "owner_approved" && <p>This approval applies to this request only. It does not change the general policy, and nothing has been paid or sent yet.</p>}
            </div>
          )}

          <section className={`card rule-card ${r.decision}`} aria-label="Rule check">
            <span className={`rule-tag ${r.decision}`}><span className="rule-tag-icon" aria-hidden="true" />Rule check: {COLOUR_WORD[r.decision]}</span>
            <h2>{ruleHeading(r.decision, r.status, r.welfare_status === "yes")}</h2>
            <p>{r.decision_reason}</p>
            {result && (result.missing.length > 0 || result.blockers.length > 0) && (
              <ul className="rule-missing">
                {result.missing.map((m) => <li key={m.message}>{m.message}</li>)}
                {result.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
            <div className="rule-foot">
              <span>Rule <code>{r.matched_rule_id}</code></span>
              <span>Rule set <code>{r.policy_version}</code></span>
              <Link href={ruleHref}>Read this rule in Knowledge Hub</Link>
            </div>
          </section>

          <section className="card" aria-label="Activity">
            <h2>Activity</h2>
            <ol className="activity">
              {pending && (
                <li className="pending">
                  <span className="act-dot" aria-hidden="true" />
                  <div><strong>{nextStep(r.status).title}</strong><p>{pending}</p></div>
                </li>
              )}
              {items.map((it) => (
                <li key={it.key}>
                  <span className={`act-dot ${it.dot}`} aria-hidden="true" />
                  <div>
                    <strong>{it.title}</strong>
                    {it.note && <p className="act-note">{it.note}</p>}
                    <p>{it.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h2>Details</h2>
            <dl className="details">
              <dt>Reference</dt><dd>{r.reference_id ?? "Not provided"}</dd>
              <dt>Type</dt><dd>{REQUEST_TYPE_LABELS[r.request_type]}</dd>
              <dt>Class</dt>
              <dd>
                <RequestClass
                  requestId={r.id}
                  saved={savedClass === "not_set_up" ? null : savedClass}
                  fromBooking={bookingClass.get(r.id) ? { bookingId: r.booking_id ?? r.reference_id ?? "", label: bookingClass.get(r.id)! } : null}
                  notSetUp={savedClass === "not_set_up"}
                />
              </dd>
              {r.amount_cents !== null && <><dt>Amount</dt><dd>{formatAud(r.amount_cents)}</dd></>}
              <dt>Status</dt><dd><StatusBadge status={r.status} /></dd>
              <dt>Created</dt><dd>{formatDateTime(r.created_at)}</dd>
              <dt>Created by</dt><dd>{createdBy}</dd>
              <dt>Source</dt><dd>{r.intake_method === "ai_intake" ? "Pasted message or Compass" : r.intake_method === "seed" ? "Seed data" : "Guided wizard"}</dd>
            </dl>
            <DataBadge label={r.data_label} />
          </section>
          <section className="next-box">
            <h2>What happens next</h2>
            <p>{whatHappensNext(r.status, user.role)}</p>
          </section>
          <RemoveFromList
            requestId={r.id}
            removed={visibility !== "not_set_up" && Boolean(visibility.hiddenAt)}
            locked={user.role !== "owner" && removalNeedsOwner(r.status, r.welfare_status)}
          />
        </aside>
      </div>

      <DraftsEditor
        requestId={r.id}
        kinds={[...draftKinds]}
        drafts={drafts}
        aiAvailable={aiConfigured() && r.welfare_status !== "yes"}
        welfare={r.welfare_status === "yes"}
      />

      <details className="card full-record">
        <summary><h2>Full record</h2><span className="hint">Facts, sources, every rule check and the AI activity log</span></summary>
        <div className="grid grid-2">
          <section>
            <h3>Confirmed facts</h3>
            <dl className="facts">
              <dt>Request type</dt><dd>{REQUEST_TYPE_LABELS[r.request_type]}</dd>
              <dt>Money involved</dt><dd>{tri(r.money_involved)}</dd>
              <dt>Amount</dt><dd>{r.amount_cents === null ? "Not provided" : formatAud(r.amount_cents)}</dd>
              {r.request_type === "lesson_change" && <><dt>Fees affected</dt><dd>{tri(r.confirmed_facts.financialImpact)}</dd><dt>New time slot</dt><dd>{r.confirmed_facts.proposedSlotId ?? "Not chosen"}</dd></>}
              {r.request_type === "payment_extension" && <><dt>Extra days</dt><dd>{r.confirmed_facts.extensionDays ?? "Not provided"}</dd></>}
              <dt>Complaint</dt><dd>{tri(r.complaint_status)}</dd>
              <dt>Welfare concern</dt><dd>{tri(r.welfare_status)}</dd>
              <dt>Reference</dt><dd>{r.reference_id ?? "Not provided"}{r.booking_id && r.booking_id !== r.reference_id ? ` (booking ${r.booking_id})` : ""}</dd>
              <dt>Context</dt><dd>{r.context || <span className="muted">None</span>}</dd>
            </dl>
          </section>
          <section>
            <h3>Rule applied</h3>
            <dl className="facts">
              <dt>Matched rule</dt><dd><code>{r.matched_rule_id}</code></dd>
              {result?.candidateRuleId && <><dt>Would apply once resolved</dt><dd><code>{result.candidateRuleId}</code></dd></>}
              <dt>Policy version</dt><dd>{snapshot ? <Link href={`/rules/${snapshot.id}`}>{snapshot.definition.title} ({policyVersionLabel(snapshot)})</Link> : r.policy_version}</dd>
              {rule && snapshot && <><dt>Rule wording</dt><dd>{rule.label}: {describeRange(snapshot.category, rule.range)}{rule.financialImpact ? `, fees affected: ${rule.financialImpact}` : ""} → <ColourBadge colour={rule.colour} /></dd></>}
              {result?.escalation && <><dt>Escalation</dt><dd>{result.escalation}</dd></>}
              <dt>Engine</dt><dd>{current?.engine_version ?? "Unknown"}</dd>
            </dl>
            {r.matched_rule_id.startsWith("safety.") && <p className="hint">Safety rules are fixed in the engine and always apply first.</p>}
          </section>
        </div>

        <div className="grid grid-2">
          <section>
            <h3>Next steps under this rule</h3>
            {result?.nextSteps.length ? <ol>{result.nextSteps.map((st) => <li key={st}>{st}</li>)}</ol> : <p className="muted">No steps recorded.</p>}
            <h3>Permitted actions</h3>
            <ul>{(result?.permittedActions ?? []).map((a) => <li key={a}>{ACTION_LABELS[a]}</li>)}</ul>
            <p className="hint">Tutor Compass prepares drafts and records decisions. It does not process payments, send messages or change bookings.</p>
          </section>
          <section>
            <h3>Supporting sources</h3>
            {evidence ? (
              <>
                <p className="hint">Snapshot taken {formatDateTime(evidence.retrievedAt)}. Later changes to these records do not change this decision.</p>
                <ul>
                  {(result?.evidence ?? []).map((e) => (
                    <li key={`${e.kind}-${e.id}`}>
                      <strong>{e.kind}</strong> {e.id}: {e.label} {e.dataLabel && <DataBadge label={e.dataLabel} />}
                    </li>
                  ))}
                </ul>
                {evidence.booking.status === "multiple" && <p className="notice warning">Several bookings matched. Choose one with Update facts.</p>}
              </>
            ) : (
              <p className="muted">No evidence snapshot was stored.</p>
            )}
            {article && (
              <div className="notice warning">
                <p><strong>{article.title}</strong> ({article.id}, version {article.version}{article.owner_approved ? ", owner approved" : ""})</p>
                <pre>{article.body}</pre>
              </div>
            )}
          </section>
        </div>

        <h3>Every rule check</h3>
        <p className="hint">Every evaluation is kept with the exact policy version and evidence it used. The fingerprint changes only if the inputs change.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>When</th><th>Decision</th><th>Rule</th><th>Policy</th><th>Why</th><th>Fingerprint</th></tr></thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td>{d.sequence}</td>
                  <td>{formatDateTime(d.created_at)}<br /><small>{d.reason === "initial" ? "First check" : d.reason === "seed" ? "Seed" : "After clarification"}{d.created_by ? `, ${names.get(d.created_by) ?? ""}` : ""}</small></td>
                  <td><ColourBadge colour={d.colour} /></td>
                  <td><code>{d.matched_rule_id}</code></td>
                  <td>{d.policy_version}</td>
                  <td>{d.result.explanation}</td>
                  <td><code title={d.input_hash}>{d.input_hash.slice(0, 10)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ActivityPanel rows={activity} />
      </details>
    </div>
  );
}
