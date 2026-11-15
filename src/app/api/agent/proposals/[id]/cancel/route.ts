import { apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { inReaderLanguage } from "@/lib/i18n/reply-server";
import { cancelProposal } from "@/lib/agent/proposals";

export const POST = apiRoute<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  return inReaderLanguage(() => cancelProposal(user, id));
});
