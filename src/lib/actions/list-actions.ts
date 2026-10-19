import "server-only";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/supabase";
import { ApiError } from "@/lib/api/handler";
import { planListAction, type ListAction, type ListState } from "@/lib/actions/list-actions-logic";

// Archives, removes or puts back one or more requests. Each request is checked on its
// own, so one the user isn't allowed to change doesn't stop the others. The result says
// which ones changed and why any didn't.

export type ListActionResult = { done: string[]; failed: Array<{ id: string; reason: string }> };

const SETUP: Record<"hidden" | "archived", string> = {
  hidden: "The database needs a quick update first. Run supabase/migrations/20261019000001_remove_from_list.sql in the Supabase SQL Editor.",
  archived: "The database needs a quick update first. Run supabase/migrations/20261019000003_archive_requests.sql in the Supabase SQL Editor.",
};

type Row = ListState & { id: string };

async function loadRows(ids: string[], needsArchive: boolean): Promise<Row[]> {
  const res = await db().from("requests").select("id, status, welfare_status, hidden_at, archived_at").in("id", ids);
  if (!res.error) return res.data as Row[];
  const msg = res.error.message ?? "";
  if (/hidden_at/.test(msg)) throw new ApiError(503, SETUP.hidden);
  if (/archived_at/.test(msg)) {
    if (needsArchive) throw new ApiError(503, SETUP.archived);
    // Removing and putting back still work before the archive update has been run.
    const old = await db().from("requests").select("id, status, welfare_status, hidden_at").in("id", ids);
    if (old.error) throw new ApiError(503, /hidden_at/.test(old.error.message) ? SETUP.hidden : "The requests couldn't be loaded. Try again.");
    return (old.data as Omit<Row, "archived_at">[]).map((r) => ({ ...r, archived_at: null }));
  }
  throw new ApiError(503, "The requests couldn't be loaded. Try again.");
}

export async function applyListAction(user: SessionUser, ids: string[], action: ListAction): Promise<ListActionResult> {
  const unique = [...new Set(ids)];
  const rows = await loadRows(unique, action === "archive" || action === "unarchive");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = new Date().toISOString();
  const result: ListActionResult = { done: [], failed: [] };

  for (const id of unique) {
    const current = byId.get(id);
    if (!current) {
      result.failed.push({ id, reason: "That request doesn't exist." });
      continue;
    }
    const plan = planListAction(action, current, user.role, user.id, now);
    if (plan.kind === "skip") {
      result.done.push(id);
      continue;
    }
    if (plan.kind === "refuse") {
      result.failed.push({ id, reason: plan.reason });
      continue;
    }
    // Only the list columns change. The guard stops two people undoing each other's change.
    let q = db().from("requests").update(plan.patch).eq("id", id);
    const guard = action === "archive" || action === "unarchive" ? "archived_at" : "hidden_at";
    q = action === "archive" || action === "remove" ? q.is(guard, null) : q.not(guard, "is", null);
    const update = await q.select("id");
    if (update.error) {
      result.failed.push({ id, reason: "The change couldn't be saved. Try again." });
      continue;
    }
    result.done.push(id);
    if ((update.data ?? []).length === 0) continue; // someone else made the same change first
    await db().from("request_events").insert({
      request_id: id,
      event_type: plan.event,
      actor_id: user.id,
      actor_role: user.role,
      from_status: current.status,
      to_status: current.status,
      note: "",
    });
  }
  return result;
}
