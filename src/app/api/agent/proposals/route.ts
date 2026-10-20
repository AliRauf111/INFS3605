import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { prepareProposal } from "@/lib/agent/proposals";

// Prepare a Compass action for confirmation. This validates and previews only. Nothing
// about a request changes until the person confirms the stored proposal.
export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  return prepareProposal(user, await readJson(req));
});
