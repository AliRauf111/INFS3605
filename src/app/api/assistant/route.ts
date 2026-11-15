import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { assistantTurn } from "@/lib/assistant/turn";

// Compass AI: one conversation turn. Signed-in staff only; the key stays on the server.
export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  return assistantTurn(user, await readJson(req));
});
