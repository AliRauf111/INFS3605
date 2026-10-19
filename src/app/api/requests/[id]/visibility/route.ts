import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db/supabase";
import { removalNeedsOwner } from "@/lib/domain/progress";

// Takes a request off the lists, or puts it back. Nothing is deleted: the request, its
// decisions and its history stay, and the change itself is written to the history.

const Body = z.object({ removed: z.boolean() }).strict();

export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "That request doesn't exist.");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Say whether to remove the request or put it back.");
  const { removed } = parsed.data;

  const current = await db().from("requests").select("id, status, welfare_status, hidden_at").eq("id", id).maybeSingle();
  if (current.error) {
    if (/hidden_at/.test(current.error.message)) {
      throw new ApiError(503, "The database needs a quick update first. Run supabase/migrations/20261019000001_remove_from_list.sql in the Supabase SQL Editor.");
    }
    throw new ApiError(503, "The request couldn't be loaded. Try again.");
  }
  if (!current.data) throw new ApiError(404, "That request doesn't exist.");
  if (Boolean(current.data.hidden_at) === removed) return { ok: true }; // already done
  if (removed && user.role !== "owner" && removalNeedsOwner(current.data.status, current.data.welfare_status)) {
    throw new ApiError(403, "Only the owner can remove a request that is waiting for them or raises a welfare concern.");
  }

  const update = await db()
    .from("requests")
    .update(removed ? { hidden_at: new Date().toISOString(), hidden_by: user.id } : { hidden_at: null, hidden_by: null })
    .eq("id", id);
  if (update.error) throw new ApiError(503, "The change couldn't be saved. Try again.");
  await db().from("request_events").insert({
    request_id: id,
    event_type: removed ? "removed_from_list" : "restored_to_list",
    actor_id: user.id,
    actor_role: user.role,
    from_status: current.data.status,
    to_status: current.data.status,
    note: "",
  });
  return { ok: true };
});
