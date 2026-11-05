import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { simulatePayment } from "@/lib/payments/server";

// Demo mode only: confirm a payment as if Xero had recorded it. Real accounting data is
// never changed, and live mode refuses this route.
const Body = z.object({ invoiceId: z.string().regex(/^INV-[0-9A-Za-z-]{2,40}$/), amountCents: z.number().int().min(1).max(10_000_000) }).strict();

export const POST = apiRoute(async (req) => {
  const user = await requireUser();
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "Choose an invoice and an amount above $0.");
  return simulatePayment(user, parsed.data.invoiceId, parsed.data.amountCents);
});
