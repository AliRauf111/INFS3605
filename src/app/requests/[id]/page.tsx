import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { getRequestDetail } from "@/lib/data/queries";
import { db } from "@/lib/db/supabase";
import { aiConfigured } from "@/lib/ai/client";
import { formatAud } from "@/lib/domain/money";
import {
  ACTION_LABELS,
  REQUEST_TYPE_LABELS,
  STATUS_LABELS,
  TRI_STATE_LABELS,
  type DraftKind,
  type TriState,
} from "@/lib/domain/types";
import { describeRange, policyVersionLabel } from "@/lib/engine/policy";
import { ActivityPanel } from "@/components/ActivityPanel";
import { ColourBadge, DataBadge, DecisionBanner, LoadError, StatusBadge, formatDateTime } from "@/components/ui";
import { RequestActions } from "./RequestActions";
import { DraftsEditor } from "./DraftsEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request" };

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
  try {
    detail = await getRequestDetail(id);
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

  return (
    <div className="stack">
      {saved && <div className="notice success" role="status">Saved. This request and its decision are stored in the database.</div>}
      <div className="page-head">
        <div>
          <h1>{REQUEST_TYPE_LABELS[r.request_type]}{r.amount_cents !== null ? ` of ${formatAud(r.amount_cents)}` : ""}</h1>
          <p className="muted">
            Created {formatDateTime(r.created_at)}{r.created_by ? ` by ${names.get(r.created_by) ?? "unknown"}` : " (seeded example)"} ·{" "}
            {r.intake_method === "ai_intake" ? "From a pasted message" : r.intake_method === "seed" ? "Seed data" : "From the wizard"} · <DataBadge label={r.data_label} />
          </p>
        </div>
        <Link href="/requests" className="btn secondary small">Back to requests</Link>
      </div>

      <DecisionBanner colour={r.decision} title={result?.outcomeLabel} explanation={r.decision_reason} />

      <section className="card">
        <div className="row"><h2 style={{ margin: 0 }}>Workflow status</h2> <StatusBadge status={r.status} /></div>
        <p className="hint">The decision colour above records what the rules said. The status shows what has happened since. An owner approval changes the status, not the original decision.</p>
        {ownerEvent && (
          <div className={`notice ${ownerEvent.event_type === "owner_approved" ? "success" : ownerEvent.event_type === "owner_declined" ? "error" : "warning"}`}>
            <p><strong>{EVENT_TEXT[ownerEvent.event_type]}</strong> on {formatDateTime(ownerEvent.created_at)}</p>
            <p>&ldquo;{ownerEvent.note}&rdquo;</p>
            {ownerEvent.event_type === "owner_approved" && <p>This approval applies to this request only. It does not change the general policy, and nothing has been paid or sent yet.</p>}
          </div>
        )}
        <RequestActions
          requestId={r.id}
          status={r.status}
          role={user.role}
          colour={r.decision}
          currentDecisionId={r.current_decision_id}
          facts={r.confirmed_facts}
          escalationDraft={escalationDraft}
        />
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h2>Confirmed facts</h2>
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
        <section className="card">
          <h2>Rule applied</h2>
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

      {result && (result.missing.length > 0 || result.blockers.length > 0) && (
        <section className="card">
          <h2>What is missing or uncertain</h2>
          <ul>
            {result.missing.map((m) => <li key={m.message}>{m.message}</li>)}
            {result.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
          {["needs_clarification", "review_required", "more_info_requested"].includes(r.status) && <p>Use <strong>Update facts</strong> above once you have the answers.</p>}
        </section>
      )}

      <div className="grid grid-2">
        <section className="card">
          <h2>Next steps</h2>
          {result?.nextSteps.length ? <ol>{result.nextSteps.map((s) => <li key={s}>{s}</li>)}</ol> : <p className="muted">No steps recorded.</p>}
          <h3>Permitted actions</h3>
          <ul>{(result?.permittedActions ?? []).map((a) => <li key={a}>{ACTION_LABELS[a]}</li>)}</ul>
          <p className="hint">Tutor Compass prepares drafts and records decisions. It does not process payments, send messages or change bookings.</p>
        </section>
        <section className="card">
          <h2>Supporting sources</h2>
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

      <DraftsEditor
        requestId={r.id}
        kinds={[...draftKinds]}
        drafts={drafts}
        aiAvailable={aiConfigured() && r.welfare_status !== "yes"}
        welfare={r.welfare_status === "yes"}
      />

      <section className="card">
        <h2>Decision history</h2>
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
      </section>

      <section className="card">
        <h2>Approval and workflow history</h2>
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="state-icon state-completed" aria-hidden="true">•</span>
              <div>
                <div><strong>{EVENT_TEXT[e.event_type] ?? e.event_type}</strong>{e.to_status ? ` → ${STATUS_LABELS[e.to_status as keyof typeof STATUS_LABELS] ?? e.to_status}` : ""}</div>
                {e.note && <div style={{ whiteSpace: "pre-wrap" }}>{e.note}</div>}
                <small>{formatDateTime(e.created_at)} · {e.actor_id ? names.get(e.actor_id) ?? e.actor_role : e.actor_role === "system" ? "Seed data" : `${e.actor_role} (seed data)`}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ActivityPanel rows={activity} />
    </div>
  );
}
