import { z } from "zod";
import { ApiError, apiRoute, readJson } from "@/lib/api/handler";
import { requireUser } from "@/lib/auth/session";
import {
  approveDraft,
  checkDelivery,
  discardDraft,
  dismissFlag,
  prepareDrafts,
  rejectDraft,
  resetRetentionDemo,
  resolveConcern,
  restoreFlag,
  runAnalysis,
  sendApproved,
  setAlertState,
  submitForApproval,
  updateDraft,
  updateSettings,
  updateTracking,
} from "@/lib/retention/server";

// Every Student Retention Agent action goes through here. The role is checked on the
// server for each action, and the database checks approval and sending again under a lock.
// Admins can prepare and edit drafts; only the owner approves, sends, dismisses flags or
// changes the settings.

const id = z.uuid();
const studentId = z.string().regex(/^ST-[0-9A-Za-z-]{1,40}$/);
const channel = z.enum(["email", "sms"]);
const version = z.number().int().min(1);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("analyse") }),
  z.object({ action: z.literal("prepare"), studentIds: z.array(studentId).min(1).max(25), channel: channel.optional() }),
  z.object({ action: z.literal("update"), id, version, subject: z.string().max(200).nullable().optional(), body: z.string().max(4000).optional(), channel: channel.optional(), regenerate: z.boolean().optional() }),
  z.object({ action: z.literal("submit"), id, version }),
  z.object({ action: z.literal("approve"), id, version }),
  z.object({ action: z.literal("reject"), id, version, reason: z.string().max(300) }),
  z.object({ action: z.literal("discard"), id }),
  z.object({ action: z.literal("send"), id, channel }),
  z.object({ action: z.literal("delivery"), id }),
  z.object({ action: z.literal("track"), id, response: z.string().max(500).optional(), followUp: z.enum(["required", "resolved"]).optional() }),
  z.object({ action: z.literal("dismiss"), studentId, reason: z.string().max(300) }),
  z.object({ action: z.literal("restore"), studentId }),
  z.object({ action: z.literal("resolve_concern"), id }),
  z.object({
    action: z.literal("settings"),
    settings: z.object({
      highThreshold: z.number().int(), mediumThreshold: z.number().int(), windowDays: z.number().int(), baselineDays: z.number().int(), minLessons: z.number().int(), cooldownDays: z.number().int(),
    }).strict(),
  }),
  z.object({ action: z.literal("alert"), key: z.string().min(1).max(400), state: z.enum(["reviewed", "dismissed", "snoozed", "open"]) }),
  z.object({ action: z.literal("reset") }),
]);

const OWNER_ONLY = new Set(["approve", "reject", "send", "delivery", "dismiss", "restore", "resolve_concern", "settings", "alert"]);

export const POST = apiRoute(async (req) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "That request wasn't understood. Reload the page and try again.");
  const b = parsed.data;
  const user = await requireUser(OWNER_ONLY.has(b.action) ? "owner" : undefined);
  switch (b.action) {
    case "analyse": return runAnalysis(user);
    case "prepare": return prepareDrafts(user, b.studentIds, b.channel);
    case "update": return updateDraft(user, b.id, { version: b.version, subject: b.subject, body: b.body, channel: b.channel, regenerate: b.regenerate });
    case "submit": return submitForApproval(user, b.id, b.version);
    case "approve": return approveDraft(user, b.id, b.version);
    case "reject": return rejectDraft(user, b.id, b.version, b.reason);
    case "discard": return discardDraft(user, b.id);
    case "send": return sendApproved(user, b.id, b.channel);
    case "delivery": return { detail: await checkDelivery(user, b.id) };
    case "track":
      if (b.response === undefined && !b.followUp) throw new ApiError(400, "Nothing to record.");
      return updateTracking(user, b.id, { response: b.response, followUp: b.followUp });
    case "dismiss": return dismissFlag(user, b.studentId, b.reason);
    case "restore": return restoreFlag(user, b.studentId);
    case "resolve_concern": return resolveConcern(user, b.id);
    case "settings": return updateSettings(user, b.settings);
    case "alert": return setAlertState(user, b.key, b.state);
    case "reset": return resetRetentionDemo(user);
  }
});
