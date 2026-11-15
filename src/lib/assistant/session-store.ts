import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/supabase";
import { AssistantStateSchema, type AssistantState } from "./logic";

// Compass conversation state lives on the server, keyed by the chat's session key and
// tied to the signed-in user. The browser's copy is only used when the database update
// that adds agent_sessions hasn't been run yet, and even then every save is re-checked.

export type StoredState = { state: AssistantState; source: "server" | "browser" };

function missingTable(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /agent_sessions/.test(error.message ?? "")));
}

export async function loadState(sessionKey: string, user: SessionUser, fromBrowser: AssistantState): Promise<StoredState> {
  const { data, error } = await db().from("agent_sessions").select("user_id, state").eq("session_key", sessionKey).maybeSingle();
  if (missingTable(error)) return { state: fromBrowser, source: "browser" };
  if (error) throw new Error(`Could not load the conversation: ${error.message}`);
  if (!data) return { state: { task: null, awaiting: null, focus: null, run: null }, source: "server" };
  if (data.user_id !== user.id) throw new Error("conversation_owner_mismatch");
  const parsed = AssistantStateSchema.safeParse(data.state);
  return { state: parsed.success ? parsed.data : { task: null, awaiting: null, focus: null, run: null }, source: "server" };
}

export async function saveState(sessionKey: string, user: SessionUser, state: AssistantState): Promise<void> {
  const { error } = await db()
    .from("agent_sessions")
    .upsert({ session_key: sessionKey, user_id: user.id, state, updated_at: new Date().toISOString() }, { onConflict: "session_key" });
  if (error && !missingTable(error)) console.error("[assistant] could not save the conversation:", error.message);
}
