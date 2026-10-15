import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { extractFromMessage } from "@/lib/ai/intake";

export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  return extractFromMessage(user, await readJson(req));
});
