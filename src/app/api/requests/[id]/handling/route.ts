import { apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { addHandlingNote } from "@/lib/actions/requests";

// The owner's handling notes and next steps. Recorded as an event; the status stays the same.
export const POST = apiRoute<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  return addHandlingNote(user, (await params).id, await readJson(req));
});
