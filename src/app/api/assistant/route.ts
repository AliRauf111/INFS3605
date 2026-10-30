import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { inReaderLanguage } from "@/lib/i18n/reply-server";
import { assistantTurn } from "@/lib/assistant/turn";

// Compass AI: one conversation turn. Signed-in staff only; the key stays on the server.
export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  const body = await readJson(req);
  return inReaderLanguage(() => assistantTurn(user, body));
});
