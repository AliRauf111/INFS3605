import { apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { refreshSuggestions } from "@/lib/actions/suggestions";

export const POST = apiRoute(async () => refreshSuggestions(await requireUser("owner")));
