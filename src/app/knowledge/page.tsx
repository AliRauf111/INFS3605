import { requirePageUser } from "@/lib/auth/page";
import { knowledgeHub, listPolicyVersions } from "@/lib/data/queries";
import { isStale } from "@/lib/context/mappers";
import { DataBadge, LoadError } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

const PAYMENT_STATUSES = ["paid", "pending", "overdue", "refunded", "disputed"] as const;
const SLOT_STATUSES = ["free", "booked", "held"] as const;
import { RulesSection } from "@/app/rules/RulesSection";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.knowledgeHub") };
}

export default async function KnowledgePage() {
  const user = await requirePageUser();
  const { t, fmt } = await getI18n();
  let k, versions;
  try {
    [k, versions] = await Promise.all([knowledgeHub(), listPolicyVersions()]);
  } catch (e) {
    return <LoadError error={e} />;
  }
  const now = new Date();
  const tutor = (id: string) => k.tutors.find((tu) => tu.id === id)?.name ?? id;
  const student = (familyId: string) => k.families.find((f) => f.id === familyId)?.student_name ?? familyId;
  const stale = (iso: string) => isStale(iso, now) ? <span className="badge amber">{t("knowledge.stale")}</span> : null;
  const payStatus = (s: string) => ((PAYMENT_STATUSES as readonly string[]).includes(s) ? t(`knowledge.paymentStatus.${s as "paid"}`) : s);
  const slotStatus = (s: string) => ((SLOT_STATUSES as readonly string[]).includes(s) ? t(`knowledge.slotStatus.${s as "free"}`) : s);
  const synced = (system: string, at: string) => t("knowledge.synced", { system, when: fmt.dateTime(at) });
  return (
    <div className="stack">
      <PageHeader>
        <h1>{t("nav.knowledgeHub")}</h1>
        <p className="muted">{t("knowledge.intro")}</p>
      </PageHeader>

      <RulesSection user={user} versions={versions} />

      <section>
        <h2>{t("subjects.bookings")}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>{t("knowledge.col.id")}</th><th>{t("knowledge.col.student")}</th><th>{t("knowledge.col.family")}</th><th>{t("knowledge.col.subject")}</th><th>{t("subjects.col.tutor")}</th><th>{t("knowledge.col.lessons")}</th><th>{t("knowledge.col.price")}</th><th>{t("request.source")}</th></tr></thead>
          <tbody>{k.bookings.map((b) => (
            <tr key={b.id}><td><bdi>{b.id}</bdi></td><td><bdi>{student(b.family_id)}</bdi></td><td><bdi>{b.family_id}</bdi></td><td dir="auto">{b.subject}</td><td><bdi>{tutor(b.tutor_id)}</bdi></td><td>{t("knowledge.lessonsUsed", { used: b.lessons_used, purchased: b.lessons_purchased })}</td><td>{fmt.money(b.price_cents)}</td>
              <td><DataBadge label={b.data_label} /> {stale(b.last_synced_at)}<br /><small>{synced(b.source_system, b.last_synced_at)}</small></td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section>
        <h2>{t("knowledge.payments")}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>{t("knowledge.col.id")}</th><th>{t("subjects.col.booking")}</th><th>{t("knowledge.col.invoice")}</th><th>{t("requests.table.amount")}</th><th>{t("requests.table.status")}</th><th>{t("knowledge.col.paidDue")}</th><th>{t("request.source")}</th></tr></thead>
          <tbody>{k.payments.map((p) => (
            <tr key={p.id}><td><bdi>{p.id}</bdi></td><td><bdi>{p.booking_id}</bdi></td><td><bdi>{p.invoice_ref}</bdi></td><td>{fmt.money(p.amount_cents)}</td><td>{payStatus(p.status)}</td><td>{p.paid_at ? fmt.dateTime(p.paid_at) : p.due_date ? t("knowledge.due", { date: fmt.date(`${p.due_date}T12:00:00+10:00`) }) : t("common.none")}</td>
              <td><DataBadge label={p.data_label} /> {stale(p.last_synced_at)}<br /><small>{synced(p.source_system, p.last_synced_at)}</small></td></tr>
          ))}</tbody>
        </table></div>
        <p className="hint">{t("knowledge.conflictHint")}</p>
      </section>

      <section>
        <h2>{t("knowledge.availability")}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>{t("knowledge.col.slot")}</th><th>{t("subjects.col.tutor")}</th><th>{t("knowledge.col.starts")}</th><th>{t("requests.table.status")}</th><th>{t("request.source")}</th></tr></thead>
          <tbody>{k.slots.map((s) => (
            <tr key={s.id}><td><bdi>{s.id}</bdi></td><td><bdi>{tutor(s.tutor_id)}</bdi></td><td>{fmt.dateTime(s.starts_at)}</td><td>{slotStatus(s.status)}</td><td><DataBadge label={s.data_label} /> {stale(s.last_synced_at)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section id="procedures" className="stack">
        <h2>{t("knowledge.procedures")}</h2>
        <p className="hint">{t("knowledge.proceduresHint")}</p>
        {k.articles.map((a) => (
          <details key={a.id} id={`article-${a.id}`} className="card">
            <summary><strong dir="auto">{a.title}</strong> (<bdi>{a.id}</bdi>, v{a.version}) {a.owner_approved && <span className="badge lilac">{t("knowledge.ownerApproved")}</span>} <DataBadge label={a.data_label} /></summary>
            <pre dir="auto">{a.body}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
