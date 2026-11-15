import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { applyListAction } from "@/lib/actions/list-actions";
import { LIST_ACTIONS } from "@/lib/actions/list-actions-logic";

// Archives, removes or puts back several requests at once. Nothing is deleted and no
// decision, status or payment changes. The reply lists which requests changed and which
// didn't, with a reason for each one that didn't.

const Body = z
  .object({
    action: z.enum(LIST_ACTIONS),
    ids: z.array(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)).min(1).max(100),
  })
  .strict();

export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Choose between 1 and 100 requests and an action.");
  return applyListAction(user, parsed.data.ids, parsed.data.action);
});
