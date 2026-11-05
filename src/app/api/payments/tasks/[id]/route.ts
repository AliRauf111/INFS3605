import { z } from "zod";
import { ApiError, apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { completeTask } from "@/lib/payments/server";

// Mark a follow-up task as done.
export const POST = apiRoute<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "That task no longer exists.");
  await completeTask(user, id);
  return { ok: true };
});
