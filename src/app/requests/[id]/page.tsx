import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/page";
import { getRequestDetail, requestVisibility, type ListVisibility } from "@/lib/data/queries";
import { db } from "@/lib/db/supabase";
import { aiConfigured } from "@/lib/ai/client";
import { ACTIONS, type ActionKey, type DraftKind, type RequestType, type TriState } from "@/lib/domain/types";
import { getI18n } from "@/lib/i18n/server";
import { describeRange, policyVersionLabel } from "@/lib/engine/policy";
import { ActivityPanel } from "@/components/ActivityPanel";
import { ColourBadge, DataBadge, LoadError, StatusBadge } from "@/components/ui";
import { progressHeading, requestProgress, ruleHeading } from "@/lib/domain/progress";
import { rowWorkflow } from "@/lib/data/queries";
import { countMissing } from "@/lib/workflow/next-step";
import { RequestActions } from "./RequestActions";
import { DraftsEditor } from "./DraftsEditor";
import { RemoveFromList } from "./RemoveFromList";
import { RequestClass } from "./RequestClass";
import { classesForRequests, savedRequestClass } from "@/lib/data/catalogue";
import { removalNeedsOwner } from "@/lib/domain/progress";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("request.title") };
}

const EVENTS = [
  "created", "reevaluated", "sent_to_owner", "owner_review_started", "owner_handling_note", "owner_approved", "owner_declined",
  "owner_requested_info", "admin_replied", "admin_recorded", "closed", "removed_from_list", "restored_to_list", "archived", "unarchived", "class_changed",
] as const;
type EventKey = (typeof EVENTS)[number];
const isEvent = (e: string): e is EventKey => (EVENTS as readonly string[]).includes(e);

const DRAFTS_FOR_ACTION: Partial<Record<string, DraftKind>> = {
  prepare_parent_response: "parent_response",
  prepare_tutor_message: "tutor_message",
  prepare_escalation_summary: "escalation_summary",
  prepare_reschedule_proposal: "reschedule_proposal",
  prepare_admin_checklist: "admin_checklist",
};

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; details?: string }> }) {
  const user = await requirePageUser();
  const { t, fmt } = await getI18n();
  const tri = (v: TriState | null) => (v ? t(`domain.triState.${v}`) : t("request.notAnswered"));
  const eventText = (e: string) => (isEvent(e) ? t(`request.event.${e}`) : e);
  const colourWord = (c: "green" | "amber" | "red") => t(`domain.colourShort.${c}`);
  const typeLabel = (k: RequestType) => t(`domain.requestType.${k}`);
  const actionLabel = (a: string) => ((ACTIONS as readonly string[]).includes(a) ? t(`domain.action.${a as ActionKey}`) : a);
  const friendly = (iso: string, inSentence = false) => fmt.friendly(iso, new Date(), inSentence);
  const { id } = await params;
  const { saved, details } = await searchParams;
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
  const ownerEvent = [...events].reverse().find((e) => ["owner_approved", "owner_declined", "owner_requested_info"].includes(e.event_type));
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

  // What this person can do next comes from the shared next-step rules (role, status,
  // missing details and whether the owner has started a review), never from colour alone.
  const wf = rowWorkflow(r, user.role, t);
  const missingCount = countMissing(result?.missing);
  const needed = (result?.missing ?? []).filter((m) => m.fact !== "policy" && m.fact !== "request_type");
  const reviewer = r.owner_review_started_by ? names.get(r.owner_review_started_by) : undefined;
  const reviewStartedText = r.owner_review_started_at
    ? reviewer
      ? t("request.reviewStartedBy", { when: friendly(r.owner_review_started_at, true), name: reviewer })
      : t("request.reviewStarted", { when: friendly(r.owner_review_started_at, true) })
    : null;
  const steps = requestProgress(r.status, Boolean(ownerEvent) || events.some((e) => e.event_type === "sent_to_owner" || e.event_type === "owner_review_started"), {
    missing: missingCount,
    reviewStarted: wf.reviewStarted,
  }, t);
  const heading = progressHeading(steps, t);
  const pending = wf.pending;
  const createdBy = r.created_by ? names.get(r.created_by) ?? t("request.unknown") : t("request.seedData");
  const ruleHref = snapshot ? `/rules/${snapshot.id}` : "/knowledge#rules";
  type Item = { key: string; at: string; order: number; dot: string; title: string; detail?: string; note?: string | null };
  const items: Item[] = [
    ...decisions.map((d) => ({
      key: `d-${d.id}`,
      at: d.created_at,
      order: 1,
      dot: d.colour,
      title: t("request.ruleCheckReturned", { colour: colourWord(d.colour) }),
      detail: t("request.matched", { when: friendly(d.created_at), rule: d.matched_rule_id }),
    })),
    ...events.map((e) => ({
      key: `e-${e.id}`,
      at: e.created_at,
      order: e.event_type === "created" ? 0 : 2,
      dot: e.event_type === "owner_declined" ? "red" : e.event_type === "owner_approved" || e.event_type === "closed" ? "lilac" : "navy",
      title: e.event_type === "created" ? t("request.createdBy", { name: e.actor_id ? names.get(e.actor_id) ?? t("request.unknownLower") : t("request.seedDataLower") }) : eventText(e.event_type),
      detail: `${friendly(e.created_at)}${e.event_type !== "created" && e.actor_id ? ` · ${names.get(e.actor_id) ?? t(e.actor_role === "owner" ? "domain.role.owner" : "domain.role.admin")}` : ""}`,
      note: e.event_type === "created" ? null : e.note,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.order - a.order);

  return (
    <div className="stack rq-page">
      {saved && <div className="notice success" role="status">{t("request.saved")}</div>}
      {visibility !== "not_set_up" && visibility.hiddenAt && (
        <div className="notice warning" role="status">
          {visibility.hiddenBy && names.get(visibility.hiddenBy)
            ? t("request.removedBy", { when: friendly(visibility.hiddenAt, true), name: names.get(visibility.hiddenBy)! })
            : t("request.removedAt", { when: friendly(visibility.hiddenAt, true) })}
        </div>
      )}
      {visibility !== "not_set_up" && visibility.archivedAt && !visibility.hiddenAt && (
        <div className="notice info" role="status">
          {t("request.archivedAt", { when: friendly(visibility.archivedAt, true) })} <Link href="/requests?archived=1">{t("requests.archivedHeading")}</Link>. {t("request.archivedRest")}
        </div>
      )}
      <nav className="crumbs" aria-label={t("request.breadcrumb")}>
        <Link href="/requests">{t("nav.requests")}</Link> <span aria-hidden="true" className="crumb-sep">›</span> <span aria-current="page"><bdi>{r.reference_id ?? t("request.title")}</bdi></span>
      </nav>

      <RequestActions
        requestId={r.id}
        status={r.status}
        role={user.role}
        colour={r.decision}
        currentDecisionId={r.current_decision_id}
        facts={r.confirmed_facts}
        escalationDraft={escalationDraft}
        workflow={wf}
        needed={wf.can.completeDetails ? needed : []}
        reviewStartedText={reviewStartedText}
        openDetails={details === "1"}
      >
        <p className="rq-kicker">{typeLabel(r.request_type)} · {t("request.createdWhen", { when: friendly(r.created_at, true) })}</p>
        <h1><bdi>{r.reference_id ?? typeLabel(r.request_type)}</bdi>{r.amount_cents !== null && <span className="rq-amount"> · {fmt.money(r.amount_cents)}</span>}</h1>
      </RequestActions>

      <section className="card rq-progress" aria-label={t("request.progress")}>
        <div className="rq-progress-head">
          <h2>{heading.title}</h2>
          <span className="muted">{heading.aside}</span>
        </div>
        <ol className="stepper">
          {steps.map((s) => (
            <li key={s.key} className={`step ${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
              <span className="step-dot" aria-hidden="true">{s.state === "done" ? "✓" : ""}</span>
              <span className="step-label">{s.label}</span>
              {s.note && <span className="step-note">{s.note}</span>}
              <span className="sr-only">{` (${t(`request.stepState.${s.state}`)})`}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="rq-layout">
        <div className="stack">
          {ownerEvent && (
            <div className={`notice ${ownerEvent.event_type === "owner_approved" ? "success" : ownerEvent.event_type === "owner_declined" ? "error" : "warning"}`}>
              <p>{t("request.ownerEventOn", { event: eventText(ownerEvent.event_type), when: fmt.dateTime(ownerEvent.created_at) })}</p>
              <p>&ldquo;<bdi>{ownerEvent.note}</bdi>&rdquo;</p>
              {ownerEvent.event_type === "owner_approved" && <p>{t("request.approvalScope")}</p>}
            </div>
          )}

          <section className={`card rule-card ${r.decision}`} aria-label={t("request.ruleCheck")}>
            <span className={`rule-tag ${r.decision}`}><span className="rule-tag-icon" aria-hidden="true" />{t("request.ruleCheckColour", { colour: colourWord(r.decision) })}</span>
            <h2>{ruleHeading(r.decision, r.status, r.welfare_status === "yes", user.role, missingCount, t)}</h2>
            {/* The rule engine's own wording, stored with the decision as part of its record. */}
            <p lang="en" dir="auto">{r.decision_reason}</p>
            {result && (result.missing.length > 0 || result.blockers.length > 0) && (
              <ul className="rule-missing" lang="en" dir="auto">
                {result.missing.map((m) => <li key={m.message}>{m.message}</li>)}
                {result.blockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
            <div className="rule-foot">
              <span>{t("request.rule")} <code>{r.matched_rule_id}</code></span>
              <span>{t("request.ruleSet")} <code>{r.policy_version}</code></span>
              <Link href={ruleHref}>{t("request.readRule")}</Link>
            </div>
          </section>

          <section className="card" aria-label={t("request.activity")}>
            <h2>{t("request.activity")}</h2>
            <ol className="activity">
              {pending && (
                <li className="pending">
                  <span className="act-dot" aria-hidden="true" />
                  <div><strong>{wf.title}</strong><p>{pending}</p></div>
                </li>
              )}
              {items.map((it) => (
                <li key={it.key}>
                  <span className={`act-dot ${it.dot}`} aria-hidden="true" />
                  <div>
                    <strong>{it.title}</strong>
                    {it.note && <p className="act-note" dir="auto">{it.note}</p>}
                    <p>{it.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h2>{t("request.details")}</h2>
            <dl className="details">
              <dt>{t("requests.table.reference")}</dt><dd><bdi>{r.reference_id ?? t("common.notProvided")}</bdi></dd>
              <dt>{t("requests.table.type")}</dt><dd>{typeLabel(r.request_type)}</dd>
              <dt>{t("request.class")}</dt>
              <dd>
                <RequestClass
                  requestId={r.id}
                  saved={savedClass === "not_set_up" ? null : savedClass}
                  fromBooking={bookingClass.get(r.id) ? { bookingId: r.booking_id ?? r.reference_id ?? "", label: bookingClass.get(r.id)! } : null}
                  notSetUp={savedClass === "not_set_up"}
                />
              </dd>
              {r.amount_cents !== null && <><dt>{t("requests.table.amount")}</dt><dd>{fmt.money(r.amount_cents)}</dd></>}
              <dt>{t("requests.table.status")}</dt><dd><StatusBadge status={r.status} /></dd>
              <dt>{t("requests.table.created")}</dt><dd>{fmt.dateTime(r.created_at)}</dd>
              <dt>{t("request.createdByLabel")}</dt><dd><bdi>{createdBy}</bdi></dd>
              <dt>{t("request.source")}</dt><dd>{r.intake_method === "ai_intake" ? t("request.sourceAi") : r.intake_method === "seed" ? t("request.seedData") : t("request.sourceWizard")}</dd>
            </dl>
            <DataBadge label={r.data_label} />
          </section>
          <section className="next-box">
            <h2>{t("request.whatNext")}</h2>
            <p>{wf.whatNext}</p>
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
        <summary><h2>{t("request.fullRecord")}</h2><span className="hint">{t("request.fullRecordHint")}</span></summary>
        <div className="grid grid-2">
          <section>
            <h3>{t("request.confirmedFacts")}</h3>
            <dl className="facts">
              <dt>{t("request.requestType")}</dt><dd>{typeLabel(r.request_type)}</dd>
              <dt>{t("request.moneyInvolved")}</dt><dd>{tri(r.money_involved)}</dd>
              <dt>{t("requests.table.amount")}</dt><dd>{fmt.money(r.amount_cents)}</dd>
              {r.request_type === "lesson_change" && <><dt>{t("request.feesAffected")}</dt><dd>{tri(r.confirmed_facts.financialImpact)}</dd><dt>{t("request.newSlot")}</dt><dd><bdi>{r.confirmed_facts.proposedSlotId ?? t("request.notChosen")}</bdi></dd></>}
              {r.request_type === "payment_extension" && <><dt>{t("request.extraDays")}</dt><dd>{r.confirmed_facts.extensionDays ?? t("common.notProvided")}</dd></>}
              <dt>{t("request.complaint")}</dt><dd>{tri(r.complaint_status)}</dd>
              <dt>{t("request.welfare")}</dt><dd>{tri(r.welfare_status)}</dd>
              <dt>{t("requests.table.reference")}</dt><dd><bdi>{r.reference_id ?? t("common.notProvided")}</bdi>{r.booking_id && r.booking_id !== r.reference_id ? <> {t("request.bookingAside", { id: r.booking_id })}</> : null}</dd>
              <dt>{t("request.context")}</dt><dd dir="auto">{r.context || <span className="muted">{t("common.none")}</span>}</dd>
            </dl>
          </section>
          <section>
            <h3>{t("request.ruleApplied")}</h3>
            <dl className="facts">
              <dt>{t("request.matchedRule")}</dt><dd><code>{r.matched_rule_id}</code></dd>
              {result?.candidateRuleId && <><dt>{t("request.wouldApply")}</dt><dd><code>{result.candidateRuleId}</code></dd></>}
              <dt>{t("request.policyVersion")}</dt><dd>{snapshot ? <Link href={`/rules/${snapshot.id}`}>{snapshot.definition.title} ({policyVersionLabel(snapshot)})</Link> : r.policy_version}</dd>
              {rule && snapshot && <><dt>{t("request.ruleWording")}</dt><dd><span dir="auto">{rule.label}</span>: <span lang="en">{describeRange(snapshot.category, rule.range)}</span>{rule.financialImpact ? `, ${t("request.feesAffectedValue", { value: rule.financialImpact })}` : ""} <span className="dir-arrow" aria-hidden="true">→</span> <ColourBadge colour={rule.colour} /></dd></>}
              {result?.escalation && <><dt>{t("request.escalation")}</dt><dd lang="en" dir="auto">{result.escalation}</dd></>}
              <dt>{t("request.engine")}</dt><dd>{current?.engine_version ?? t("request.unknown")}</dd>
            </dl>
            {r.matched_rule_id.startsWith("safety.") && <p className="hint">{t("request.safetyHint")}</p>}
          </section>
        </div>

        <div className="grid grid-2">
          <section>
            <h3>{t("request.nextStepsRule")}</h3>
            {result?.nextSteps.length ? <ol dir="auto">{result.nextSteps.map((st) => <li key={st}>{st}</li>)}</ol> : <p className="muted">{t("request.noSteps")}</p>}
            <h3>{t("request.permittedActions")}</h3>
            <ul>{(result?.permittedActions ?? []).map((a) => <li key={a}>{user.role === "owner" && a === "send_to_owner" ? t("request.ownerReviewDirect") : actionLabel(a)}</li>)}</ul>
            <p className="hint">{t("request.noOutsideActions")}</p>
          </section>
          <section>
            <h3>{t("request.sources")}</h3>
            {evidence ? (
              <>
                <p className="hint">{t("request.snapshotTaken", { when: fmt.dateTime(evidence.retrievedAt) })}</p>
                <ul>
                  {(result?.evidence ?? []).map((e) => (
                    <li key={`${e.kind}-${e.id}`}>
                      <strong>{e.kind}</strong> <bdi>{e.id}</bdi>: <span dir="auto">{e.label}</span> {e.dataLabel && <DataBadge label={e.dataLabel} />}
                    </li>
                  ))}
                </ul>
                {evidence.booking.status === "multiple" && <p className="notice warning">{t("request.severalBookings", { action: wf.can.completeDetails && missingCount ? t("actions.completeDetails") : t("actions.updateFacts") })}</p>}
              </>
            ) : (
              <p className="muted">{t("request.noSnapshot")}</p>
            )}
            {article && (
              <div className="notice warning">
                <p><strong dir="auto">{article.title}</strong> ({article.owner_approved ? t("request.articleMetaApproved", { id: article.id, version: article.version }) : t("request.articleMeta", { id: article.id, version: article.version })})</p>
                <pre dir="auto">{article.body}</pre>
              </div>
            )}
          </section>
        </div>

        <h3>{t("request.everyCheck")}</h3>
        <p className="hint">{t("request.everyCheckHint")}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>{t("request.when")}</th><th>{t("requests.table.decision")}</th><th>{t("request.rule")}</th><th>{t("request.policy")}</th><th>{t("request.why")}</th><th>{t("request.fingerprint")}</th></tr></thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td>{d.sequence}</td>
                  <td>{fmt.dateTime(d.created_at)}<br /><small>{d.reason === "initial" ? t("request.firstCheck") : d.reason === "seed" ? t("request.seed") : t("request.afterClarification")}{d.created_by ? `, ${names.get(d.created_by) ?? ""}` : ""}</small></td>
                  <td><ColourBadge colour={d.colour} /></td>
                  <td><code>{d.matched_rule_id}</code></td>
                  <td>{d.policy_version}</td>
                  <td lang="en" dir="auto">{d.result.explanation}</td>
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
