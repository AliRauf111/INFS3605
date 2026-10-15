import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { transitionRequest } from "@/lib/actions/requests";

export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  return transitionRequest(user, (await params).id, await readJson(req));
});
