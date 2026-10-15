import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { createPolicyDraft } from "@/lib/actions/policies";

export const POST = apiRoute(async (req) => createPolicyDraft(await requireUser("owner"), await readJson(req)));
