import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { updateMessage } from "@/lib/payments/server";

// Edit one draft, or include or leave out one recipient, before the batch is approved.
const Body = z.object({
  body: z.string().max(4000).optional(),
  subject: z.string().max(200).nullable().optional(),
  included: z.boolean().optional(),
}).strict();

export const PATCH = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "That message no longer exists.");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "That change couldn't be saved.");
  return updateMessage(user, id, parsed.data);
});
