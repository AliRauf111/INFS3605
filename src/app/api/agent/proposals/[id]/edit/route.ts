import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { inReaderLanguage } from "@/lib/i18n/reply-server";
import { editProposal } from "@/lib/agent/proposals";

// Editing replaces the proposal with a new preview. The old one can no longer be confirmed.
export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const body = await readJson(req);
  return inReaderLanguage(() => editProposal(user, id, body));
});
