import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { generateDraft, saveDraft } from "@/lib/actions/drafts";

export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  return generateDraft(user, (await params).id, await readJson(req));
});

export const PUT = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  return saveDraft(user, (await params).id, await readJson(req));
});
