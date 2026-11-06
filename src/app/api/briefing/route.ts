import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import { SECTION_IDS } from "@/lib/briefing/types";
import { cardStatus } from "@/lib/briefing/logic";
import { currentBriefing, emailPreview, generate, resetBriefingDemo, saveSettings, sendNow, viewForUser } from "@/lib/briefing/server";

// The Weekly Owner Briefing's actions. The role is checked on the server for each one:
// anyone signed in can open or refresh the briefing (admins see it without the financial
// figures unless the owner allows them); only the owner changes the settings, previews or
// sends the email, or resets the demo.

const Settings = z.object({
  enabled: z.boolean(),
  sendDay: z.number().int().min(1).max(7),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  sections: z.array(z.enum(SECTION_IDS)).max(SECTION_IDS.length),
  recipientId: z.uuid().nullable(),
  adminFinance: z.boolean(),
  thresholds: z.object({
    overdueRedDays: z.number().int().min(1).max(120),
    overdueRedCount: z.number().int().min(1).max(50),
    enquiryAmberHours: z.number().int().min(1).max(336),
    enquiryRedHours: z.number().int().min(2).max(720),
    coverRedHours: z.number().int().min(1).max(336),
  }).strict(),
}).strict();

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate") }),
  z.object({ action: z.literal("settings"), settings: Settings }),
  z.object({ action: z.literal("preview") }),
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("reset") }),
]);

const OWNER_ONLY = new Set(["settings", "preview", "send", "reset"]);

/** The Overview card: this week's briefing, worked out if there isn't one yet. */
export const GET = apiRoute(async () => {
  const user = await requireUser();
  const view = await viewForUser(user, await currentBriefing(user));
  return { status: cardStatus(view, false), view };
});

export const POST = apiRoute(async (req) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "That request wasn't understood. Reload the page and try again.");
  const b = parsed.data;
  const user = await requireUser(OWNER_ONLY.has(b.action) ? "owner" : undefined);
  switch (b.action) {
    case "generate": return { view: await viewForUser(user, await generate(user, "manual")) };
    case "settings": return { settings: await saveSettings(user, { ...b.settings, updatedAt: null }) };
    case "preview": return emailPreview(user);
    case "send": return sendNow(user);
    case "reset": await resetBriefingDemo(user); return { ok: true };
  }
});
