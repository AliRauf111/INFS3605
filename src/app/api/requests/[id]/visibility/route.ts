import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { applyListAction } from "@/lib/actions/list-actions";

// Takes a request off the lists, or puts it back. Nothing is deleted: the request, its
// decisions and its history stay, and the change itself is written to the history.
// This uses the same rules as removing several requests from the Requests page.

const Body = z.object({ removed: z.boolean() }).strict();

export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "That request doesn't exist.");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Say whether to remove the request or put it back.");

  const result = await applyListAction(user, [id], parsed.data.removed ? "remove" : "restore");
  const failure = result.failed[0];
  if (failure) {
    if (failure.reason.startsWith("That request")) throw new ApiError(404, failure.reason);
    if (failure.reason.startsWith("Only the owner")) throw new ApiError(403, failure.reason);
    throw new ApiError(503, failure.reason);
  }
  return { ok: true };
});
