import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { checkPolicy } from "@/lib/actions/policies";

export const POST = apiRoute(async (req) => {
  await requireUser();
  return checkPolicy(await readJson(req));
});
