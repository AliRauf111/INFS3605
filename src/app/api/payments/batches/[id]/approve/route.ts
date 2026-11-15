import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { approveBatch } from "@/lib/payments/server";

// The owner's single approval for the whole batch. The database checks every message
// again (balances, permissions, extensions and disputes, duplicates) before it goes.
// "simulated" must be true in demo mode and false when live providers are configured.
const Body = z.object({ version: z.number().int().min(1), simulated: z.boolean() }).strict();

export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser("owner");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, "That batch no longer exists.");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Reload the page and review the batch again.");
  return approveBatch(user, id, parsed.data.version, parsed.data.simulated);
});
