import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { db, toDbError } from "@/lib/db/supabase";
import { ApiError } from "@/lib/api/handler";
import { coverageData } from "@/lib/data/queries";
import { logActivity } from "@/lib/agent/activity";

function requireOwner(user: SessionUser) {
  if (user.role !== "owner") throw new ApiError(403, "Only the owner can manage rule suggestions.");
}

/** Save new suggestions found in the records. Existing ones are left alone. */
export async function refreshSuggestions(user: SessionUser) {
  requireOwner(user);
  const { candidates } = await coverageData();
  if (candidates.length === 0) return { added: 0 };
  const { data, error } = await db()
    .from("rule_suggestions")
    .upsert(
      candidates.map((c) => ({
        category: c.category,
        pattern_key: c.patternKey,
        summary: c.summary,
        proposal: c.definition,
        based_on_request_ids: c.requestIds,
        generated_by: "system",
      })),
      { onConflict: "pattern_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw toDbError(error);
  const added = data?.length ?? 0;
  if (added) {
    await logActivity({
      sessionKey: crypto.randomUUID(), actorId: user.id, mode: "system", eventType: "suggestion_prepared", state: "completed",
      summary: `${added} rule suggestion${added > 1 ? "s" : ""} prepared from repeated owner approvals. None are active.`,
    });
  }
  return { added };
}

export async function draftFromSuggestion(user: SessionUser, id: string) {
  requireOwner(user);
  const { data: s } = await db().from("rule_suggestions").select("id, category, proposal, status, summary").eq("id", id).maybeSingle();
  if (!s) throw new ApiError(404, "Suggestion not found.");
  if (s.status !== "open") throw new ApiError(409, "This suggestion has already been handled.");
  const { data, error } = await db().rpc("create_policy_draft", {
    p_actor: user.id,
    p_category: s.category,
    p_definition: s.proposal,
    p_note: `From suggestion: ${s.summary}`.slice(0, 1000),
    p_source: "suggestion",
  });
  if (error) throw toDbError(error);
  const draft = data as { id: string; version: number };
  await db().from("rule_suggestions").update({ status: "drafted", draft_policy_version_id: draft.id }).eq("id", id).eq("status", "open");
  return draft;
}

export async function dismissSuggestion(user: SessionUser, id: string) {
  requireOwner(user);
  const { data, error } = await db().from("rule_suggestions").update({ status: "dismissed" }).eq("id", id).eq("status", "open").select("id").maybeSingle();
  if (error) throw toDbError(error);
  if (!data) throw new ApiError(409, "This suggestion has already been handled.");
  await db().from("audit_events").insert({ actor_id: user.id, actor_role: "owner", action: "suggestion.dismiss", entity_type: "rule_suggestion", entity_id: id, detail: {} });
  return { dismissed: true };
}
