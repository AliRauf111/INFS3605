import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { deletePolicyDraft, updatePolicyDraft } from "@/lib/actions/policies";

export const PUT = apiRoute<{ id: string }>(async (req, { params }) =>
  updatePolicyDraft(await requireUser("owner"), (await params).id, await readJson(req)),
);

export const DELETE = apiRoute<{ id: string }>(async (_req, { params }) => deletePolicyDraft(await requireUser("owner"), (await params).id));
