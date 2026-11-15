import { apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { startOwnerReview } from "@/lib/actions/requests";

// Start Review: an explicit owner action. Opening a request never calls this.
export const POST = apiRoute<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  return startOwnerReview(user, (await params).id);
});
