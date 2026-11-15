import { db } from "@/lib/db/supabase";
import { aiConfigured, aiModel } from "@/lib/ai/client";
import { formatDateTime } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";

type State = "live" | "keySet" | "simulated" | "notConnected" | "error";
type Row = { name: string; state: State; detail: string };

// What this deployment is really connected to, shown at the bottom of the Coverage page
export async function IntegrationsSection() {
  const { t, fmt } = await getI18n();
  const { error } = await db().from("requests").select("id", { head: true, count: "exact" });
  // Only a real AI call that worked counts as live. Having a key set is not proof.
  const { data: lastAi } = await db()
    .from("ai_activity")
    .select("mode, event_type, summary, created_at")
    .or("mode.eq.live_ai,event_type.eq.ai_unavailable")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const claude = t("integrations.claude");
  let aiRow: Row;
  if (!aiConfigured()) {
    aiRow = { name: claude, state: "simulated", detail: t("integrations.aiSimulated") };
  } else if (lastAi?.mode === "live_ai") {
    aiRow = { name: claude, state: "live", detail: t("integrations.aiLive", { when: formatDateTime(lastAi.created_at, fmt), model: aiModel() }) };
  } else if (lastAi?.event_type === "ai_unavailable") {
    // The failure summary is the server's own log text, shown as recorded.
    aiRow = { name: claude, state: "error", detail: t("integrations.aiFailed", { when: formatDateTime(lastAi.created_at, fmt), summary: lastAi.summary }) };
  } else {
    aiRow = { name: claude, state: "keySet", detail: t("integrations.aiKeySet", { model: aiModel() }) };
  }
  const rows: Row[] = [
    { name: t("integrations.database"), state: error ? "error" : "live", detail: error ? t("integrations.databaseError", { message: error.message }) : t("integrations.databaseLive") },
    { name: t("integrations.auth"), state: "live", detail: t("integrations.authLive") },
    aiRow,
    { name: t("integrations.booking"), state: "notConnected", detail: t("integrations.bookingDetail") },
    { name: t("integrations.payment"), state: "notConnected", detail: t("integrations.paymentDetail") },
    { name: t("integrations.calendar"), state: "notConnected", detail: t("integrations.calendarDetail") },
    { name: t("integrations.email"), state: "notConnected", detail: t("integrations.emailDetail") },
  ];
  const cls: Record<State, string> = { live: "lilac", keySet: "info", simulated: "info", notConnected: "", error: "red" };
  return (
    <section id="integrations" className="stack" aria-labelledby="integrations-heading">
      <div>
        <h2 id="integrations-heading">{t("integrations.heading")}</h2>
        <p className="muted">{t("integrations.intro")}</p>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("integrations.service")}</th><th>{t("integrations.state")}</th><th>{t("integrations.meaning")}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.name}><td>{r.name}</td><td><span className={`badge ${cls[r.state]}`}>{t(`integrations.states.${r.state}`)}</span></td><td>{r.detail}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}
