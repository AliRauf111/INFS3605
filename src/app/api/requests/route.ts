import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { submitRequest } from "@/lib/actions/requests";
import { listRequests } from "@/lib/data/queries";

export const GET = apiRoute(async () => {
  await requireUser();
  const rows = await listRequests({ limit: 50 });
  return { requests: rows.map(({ confirmed_facts: _f, ...r }) => r) };
});

export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  return submitRequest(user, await readJson(req));
});
