import { requirePageUser } from "@/lib/auth/page";
import { knowledgeHub } from "@/lib/data/queries";
import { formatAud } from "@/lib/domain/money";
import { isStale } from "@/lib/context/mappers";
import { DataBadge, LoadError, formatDateTime } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Knowledge hub" };

export default async function KnowledgePage() {
  await requirePageUser();
  let k;
  try {
    k = await knowledgeHub();
  } catch (e) {
    return <LoadError error={e} />;
  }
  const now = new Date();
  const tutor = (id: string) => k.tutors.find((t) => t.id === id)?.name ?? id;
  const student = (familyId: string) => k.families.find((f) => f.id === familyId)?.student_name ?? familyId;
  const stale = (iso: string) => isStale(iso, now) ? <span className="badge amber">! May be out of date</span> : null;
  return (
    <div className="stack">
      <h1>Knowledge hub</h1>
      <p className="muted">Bookings, payments, tutor availability and procedures in one place. The rule engine reads these records by confirmed ID. Every record here is fictional demonstration data; no outside system is connected.</p>

      <section>
        <h2>Bookings</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>ID</th><th>Student</th><th>Family</th><th>Subject</th><th>Tutor</th><th>Lessons</th><th>Price</th><th>Source</th></tr></thead>
          <tbody>{k.bookings.map((b) => (
            <tr key={b.id}><td>{b.id}</td><td>{student(b.family_id)}</td><td>{b.family_id}</td><td>{b.subject}</td><td>{tutor(b.tutor_id)}</td><td>{b.lessons_used} of {b.lessons_purchased} used</td><td>{formatAud(b.price_cents)}</td>
              <td><DataBadge label={b.data_label} /> {stale(b.last_synced_at)}<br /><small>{b.source_system}, synced {formatDateTime(b.last_synced_at)}</small></td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section>
        <h2>Payments</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>ID</th><th>Booking</th><th>Invoice</th><th>Amount</th><th>Status</th><th>Paid / due</th><th>Source</th></tr></thead>
          <tbody>{k.payments.map((p) => (
            <tr key={p.id}><td>{p.id}</td><td>{p.booking_id}</td><td>{p.invoice_ref}</td><td>{formatAud(p.amount_cents)}</td><td>{p.status}</td><td>{p.paid_at ? formatDateTime(p.paid_at) : p.due_date ? `Due ${p.due_date}` : "None"}</td>
              <td><DataBadge label={p.data_label} /> {stale(p.last_synced_at)}<br /><small>{p.source_system}, synced {formatDateTime(p.last_synced_at)}</small></td></tr>
          ))}</tbody>
        </table></div>
        <p className="hint">PAY-2002 and PAY-2003 deliberately conflict (same invoice, different amounts), and PAY-2005 is deliberately stale, to show how missing or conflicting evidence blocks green.</p>
      </section>

      <section>
        <h2>Tutor availability</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Slot</th><th>Tutor</th><th>Starts</th><th>Status</th><th>Source</th></tr></thead>
          <tbody>{k.slots.map((s) => (
            <tr key={s.id}><td>{s.id}</td><td>{tutor(s.tutor_id)}</td><td>{formatDateTime(s.starts_at)}</td><td>{s.status}</td><td><DataBadge label={s.data_label} /> {stale(s.last_synced_at)}</td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="stack">
        <h2>Procedures</h2>
        {k.articles.map((a) => (
          <details key={a.id} className="card">
            <summary><strong>{a.title}</strong> ({a.id}, v{a.version}) {a.owner_approved && <span className="badge green">Owner approved</span>} <DataBadge label={a.data_label} /></summary>
            <pre>{a.body}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
