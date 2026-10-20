import { apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { confirmProposal } from "@/lib/agent/proposals";

// Confirm a prepared action. The server rechecks role, rules and record versions first,
// and the database will only ever run a proposal once.
export const POST = apiRoute<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  return confirmProposal(user, (await params).id);
});
