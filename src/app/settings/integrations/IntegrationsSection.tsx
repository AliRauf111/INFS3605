import { db } from "@/lib/db/supabase";
import { aiConfigured, aiModel } from "@/lib/ai/client";
import { formatDateTime } from "@/components/ui";

type State = "Live" | "Key set, not yet used" | "Simulated" | "Not connected" | "Error";
type Row = { name: string; state: State; detail: string };

// What this deployment is really connected to, shown at the bottom of the Coverage page
export async function IntegrationsSection() {
  const { error } = await db().from("requests").select("id", { head: true, count: "exact" });
  // Only a real AI call that worked counts as live. Having a key set is not proof.
  const { data: lastAi } = await db()
    .from("ai_activity")
    .select("mode, event_type, summary, created_at")
    .or("mode.eq.live_ai,event_type.eq.ai_unavailable")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let aiRow: Row;
  if (!aiConfigured()) {
    aiRow = { name: "Claude (Anthropic API)", state: "Simulated", detail: "No ANTHROPIC_API_KEY is set. Intake and rule proposals use clearly labelled keyword rules instead, and drafts use templates." };
  } else if (lastAi?.mode === "live_ai") {
    aiRow = { name: "Claude (Anthropic API)", state: "Live", detail: `The last AI call worked (${formatDateTime(lastAi.created_at)}). Model: ${aiModel()}. Used for message extraction, drafting and rule proposals. It never decides the colour.` };
  } else if (lastAi?.event_type === "ai_unavailable") {
    aiRow = { name: "Claude (Anthropic API)", state: "Error", detail: `The last AI call failed (${formatDateTime(lastAi.created_at)}): ${lastAi.summary} The simulated mode was used instead.` };
  } else {
    aiRow = { name: "Claude (Anthropic API)", state: "Key set, not yet used", detail: `A key is set on the server (model ${aiModel()}), but no AI call has been made yet. Try the AI intake to confirm it works.` };
  }
  const rows: Row[] = [
    { name: "Supabase database", state: error ? "Error" : "Live", detail: error ? `The server could not read the database: ${error.message}` : "All records are read and written by the Next.js server using the secret key. The browser never connects to Supabase." },
    { name: "Supabase Auth (sign-in)", state: "Live", detail: "Passwords are checked by Supabase Auth from the server. Roles come from the app_users table." },
    aiRow,
    { name: "Booking system", state: "Not connected", detail: "Bookings come from fictional demonstration rows in Supabase, shown in the Knowledge Hub. No real booking system is changed." },
    { name: "Payment system", state: "Not connected", detail: "Payments are fictional demonstration rows. Tutor Compass never processes or refunds payments." },
    { name: "Tutor calendar", state: "Not connected", detail: "Availability slots are fictional demonstration rows." },
    { name: "Email and SMS", state: "Not connected", detail: "Drafts are prepared for a person to copy and send. Nothing is sent by the app." },
  ];
  const cls: Record<State, string> = { Live: "green", "Key set, not yet used": "amber", Simulated: "amber", "Not connected": "", Error: "red" };
  return (
    <section id="integrations" className="stack" aria-labelledby="integrations-heading">
      <div>
        <h2 id="integrations-heading">Integrations</h2>
        <p className="muted">What this deployment is really connected to. Checked when the page loads.</p>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Service</th><th>State</th><th>What it means</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.name}><td>{r.name}</td><td><span className={`badge ${cls[r.state]}`}>{r.state}</span></td><td>{r.detail}</td></tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}
