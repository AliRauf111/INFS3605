import "server-only";
import { db } from "@/lib/db/supabase";

// Records what the agent and the server actually did, for the activity panel.
// Only real events are written here: nothing is invented for show.

export type ActivityEvent =
  | "details_extracted"
  | "clarification_needed"
  | "booking_retrieved"
  | "payment_found"
  | "availability_checked"
  | "policy_retrieved"
  | "missing_information"
  | "confirmation_required"
  | "decision_completed"
  | "draft_prepared"
  | "owner_review_created"
  | "rule_proposed"
  | "suggestion_prepared"
  | "ai_unavailable";

export type ActivityState = "pending" | "completed" | "blocked" | "failed";
export type ActivityMode = "live_ai" | "simulated" | "system";

export type ActivityInput = {
  sessionKey: string;
  requestId?: string | null;
  eventType: ActivityEvent;
  state: ActivityState;
  mode: ActivityMode;
  summary: string;
  detail?: Record<string, unknown>;
  actorId: string;
};

export async function logActivity(events: ActivityInput | ActivityInput[]): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return;
  const { error } = await db()
    .from("ai_activity")
    .insert(
      list.map((e) => ({
        session_key: e.sessionKey,
        request_id: e.requestId ?? null,
        event_type: e.eventType,
        state: e.state,
        mode: e.mode,
        summary: e.summary.slice(0, 500),
        detail: e.detail ?? {},
        actor_id: e.actorId,
      })),
    );
  // The activity log must not hide a failure, but it also must not block saving.
  if (error) console.error("[activity] could not record event:", error.message);
}

export type ActivityRow = {
  id: string;
  event_type: ActivityEvent;
  state: ActivityState;
  mode: ActivityMode;
  summary: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export async function activityFor(opts: { sessionKey?: string; requestId?: string }): Promise<ActivityRow[]> {
  let query = db().from("ai_activity").select("id, event_type, state, mode, summary, detail, created_at").order("created_at");
  if (opts.requestId) query = query.eq("request_id", opts.requestId);
  else if (opts.sessionKey) query = query.eq("session_key", opts.sessionKey).is("request_id", null);
  else return [];
  const { data, error } = await query.limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityRow[];
}
