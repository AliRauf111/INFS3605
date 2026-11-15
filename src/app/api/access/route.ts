import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { nameFor } from "@/lib/data/access";
import { db } from "@/lib/db/supabase";

// The owner gives a new account access as an admin, or declines it (which deletes the
// account). Nobody can give themselves access, and owners are never created here.

const Body = z.object({ userId: z.uuid(), action: z.enum(["grant", "decline"]) }).strict();

export const POST = apiRoute(async (req) => {
  await requireUser("owner");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Choose an account and an action.");
  const { userId, action } = parsed.data;

  const { data: existing } = await db().from("app_users").select("id").eq("id", userId).maybeSingle();
  if (existing) throw new ApiError(409, "This person already has access.");
  const { data, error } = await db().auth.admin.getUserById(userId);
  if (error || !data.user) throw new ApiError(404, "That account no longer exists.");

  if (action === "decline") {
    const del = await db().auth.admin.deleteUser(userId);
    if (del.error) throw new ApiError(503, "The account couldn't be removed. Try again.");
    return { ok: true };
  }
  if (!data.user.email_confirmed_at) throw new ApiError(409, "This person hasn't confirmed their email yet.");
  const insert = await db().from("app_users").insert({ id: userId, display_name: nameFor(data.user), role: "admin" });
  if (insert.error) throw new ApiError(503, "Access couldn't be given. Try again.");
  return { ok: true };
});
