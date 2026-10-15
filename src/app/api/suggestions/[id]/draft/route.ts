import { apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { draftFromSuggestion } from "@/lib/actions/suggestions";

export const POST = apiRoute<{ id: string }>(async (_req, { params }) => draftFromSuggestion(await requireUser("owner"), (await params).id));
