import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { createBatch } from "@/lib/payments/server";

// Prepares personalised reminder drafts for the families the owner or admin chose.
// Nothing is sent here: the drafts wait for the owner's approval.
const Body = z.object({
  runId: z.uuid(),
  contactIds: z.array(z.string().regex(/^BC-[0-9A-Za-z-]{2,40}$/)).min(1).max(200),
  channels: z.object({ email: z.boolean(), sms: z.boolean() }).strict(),
  includeStudents: z.boolean(),
}).strict();

export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Choose at least one family and one channel.");
  return { batchId: await createBatch(user, parsed.data) };
});
