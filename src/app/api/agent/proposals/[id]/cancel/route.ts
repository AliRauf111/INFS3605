import { apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { cancelProposal } from "@/lib/agent/proposals";

export const POST = apiRoute<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  return cancelProposal(user, (await params).id);
});
