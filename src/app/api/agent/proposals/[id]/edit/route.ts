import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { editProposal } from "@/lib/agent/proposals";

// Editing replaces the proposal with a new preview. The old one can no longer be confirmed.
export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  return editProposal(user, (await params).id, await readJson(req));
});
