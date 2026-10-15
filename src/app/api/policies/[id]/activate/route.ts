import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { activatePolicy } from "@/lib/actions/policies";

export const POST = apiRoute<{ id: string }>(async (req, { params }) =>
  activatePolicy(await requireUser("owner"), (await params).id, await readJson(req)),
);
