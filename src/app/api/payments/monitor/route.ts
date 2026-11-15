import { apiRoute } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { monitor } from "@/lib/payments/server";

// Checks for replies (Gmail and SMS) and payments (Xero) since the reminders went out,
// creates follow-up tasks and escalates families the owner's rules say need a decision.
export const POST = apiRoute(async () => {
  const user = await requireUser();
  return monitor(user);
});
