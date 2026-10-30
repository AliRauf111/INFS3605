import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { ownerQueue, rowWorkflow } from "@/lib/data/queries";
import { pendingAccounts, type PendingAccount } from "@/lib/data/access";
import { AccessRequests } from "./AccessRequests";
import { getI18n } from "@/lib/i18n/server";
import { ColourBadge, EmptyState, LoadError, StatusBadge, formatDateTime } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.approvalAlley") };
}

const PRIORITY = (p: number) => (p < 10 ? "welfare" : p < 20 ? "complaint" : p < 30 ? "red" : "normal");

export default async function OwnerQueuePage() {
  const user = await requirePageUser();
  const { t, fmt } = await getI18n();
  let items;
  try {
    items = await ownerQueue();
  } catch (e) {
    return <LoadError error={e} />;
  }
  // Only the owner sees new accounts. If the list can't load, the rest of the page still works.
  let accounts: PendingAccount[] = [];
  if (user.role === "owner") accounts = await pendingAccounts().catch(() => []);
  // The shared next-step rules decide which list each request is in, so this page agrees
  // with the dashboard and the request page.
  const owner = user.role === "owner";
  const withWf = items.map((i) => ({ ...i, wf: rowWorkflow(i.request, user.role, t) }));
  const waiting = withWf.filter((i) => (owner ? i.wf.queue === "review" : i.request.status === "awaiting_owner"));
  const other = withWf.filter((i) => !waiting.includes(i));
  return (
    <div className="stack">
      <PageHeader><h1>{t("nav.approvalAlley")}</h1></PageHeader>
      {!owner && <p className="notice info">{t("owner.viewOnlyNotice")}</p>}
      <h2>{owner ? t("owner.requiresReview", { count: waiting.length }) : t("owner.waitingDecision", { count: waiting.length })}</h2>
      {waiting.length === 0 && (
        <EmptyState title={owner ? t("owner.emptyOwnerTitle") : t("owner.emptyAdminTitle")}>
          <p>{owner ? t("owner.emptyOwnerText") : t("owner.emptyAdminText")}</p>
        </EmptyState>
      )}
      {waiting.map(({ request: r, priority, summary, events, wf }) => (
        <article key={r.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              <Link href={`/requests/${r.id}`}>{r.amount_cents !== null ? t("owner.typeOfAmount", { type: t(`domain.requestType.${r.request_type}`), amount: fmt.money(r.amount_cents) }) : t(`domain.requestType.${r.request_type}`)} · {r.reference_id ? <bdi>{r.reference_id}</bdi> : t("owner.noReference")}</Link>
            </h3>
            <div className="row"><span className="badge">{t(`owner.priority.${PRIORITY(priority)}`)}</span><ColourBadge colour={r.decision} /></div>
          </div>
          <dl className="facts" style={{ marginTop: "0.5rem" }}>
            <dt>{t("owner.rule")}</dt><dd><code dir="ltr">{r.matched_rule_id}</code> ({r.policy_version})</dd>
            <dt>{t("owner.why")}</dt><dd lang="en" dir="auto">{r.decision_reason}</dd>
            <dt>{t("owner.complaintWelfare")}</dt><dd>{r.complaint_status ? t(`domain.triState.${r.complaint_status}`) : t("owner.notAnswered")} / {r.welfare_status ? t(`domain.triState.${r.welfare_status}`) : t("owner.notAnswered")}</dd>
            <dt>{t("owner.summary")}</dt><dd style={{ whiteSpace: "pre-wrap" }} dir="auto">{summary ?? <span className="muted">{r.status === "awaiting_owner" ? t("common.none") : t("owner.notSentYet")}</span>}</dd>
            {owner && <><dt>{t("owner.yourReview")}</dt><dd>{wf.reviewStarted ? t("owner.reviewStartedAt", { when: formatDateTime(r.owner_review_started_at!, fmt) }) : t("owner.notStarted")}</dd></>}
            <dt>{t("owner.history")}</dt><dd>{t("owner.historyLine", { count: events.length, created: formatDateTime(r.created_at, fmt), updated: formatDateTime(r.updated_at, fmt) })}</dd>
          </dl>
          <p style={{ marginTop: "0.75rem" }}><Link className="btn small" href={`/requests/${r.id}`}>{owner ? (wf.reviewStarted ? t("owner.continueReview") : t("owner.reviewAndHandle")) : t("owner.viewRequest")}</Link></p>
        </article>
      ))}
      {accounts.length > 0 && (
        <section className="card" aria-labelledby="access-heading">
          <h2 id="access-heading" style={{ marginTop: 0 }}>{t("owner.accountsHeading", { count: accounts.length })}</h2>
          <p className="hint">{t("owner.accountsHint")}</p>
          <AccessRequests accounts={accounts} />
        </section>
      )}
      <h2>{owner ? t("owner.waitingDetails", { count: other.length }) : t("owner.preparedNotSent", { count: other.length })}</h2>
      <p className="hint">{owner ? t("owner.waitingDetailsHint") : t("owner.preparedHint")}</p>
      {other.length === 0 ? <p className="muted">{t("common.none")}</p> : (
        <ul>
          {other.map(({ request: r, wf }) => (
            <li key={r.id}><Link href={`/requests/${r.id}`}>{t(`domain.requestType.${r.request_type}`)} {r.reference_id ? <bdi>{r.reference_id}</bdi> : null}</Link> <ColourBadge colour={r.decision} /> <StatusBadge status={r.status} /> <span className="hint">{t("owner.nextStep", { step: wf.title })}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}
