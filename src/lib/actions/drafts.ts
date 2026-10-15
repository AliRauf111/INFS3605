import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { db, toDbError } from "@/lib/db/supabase";
import { ApiError } from "@/lib/api/handler";
import { aiConfigured, callStructured, redactForAi } from "@/lib/ai/client";
import { logActivity } from "@/lib/agent/activity";
import { DRAFT_KINDS, DRAFT_LABELS, type DraftKind, type RequestStatus } from "@/lib/domain/types";
import type { DecisionResult } from "@/lib/engine/evaluate";
import type { EvidenceSnapshot } from "@/lib/engine/evidence";
import { findUnsupportedPromises, templateDraft, type DraftContext } from "./drafts-logic";

const GenerateSchema = z.object({ kind: z.enum(DRAFT_KINDS), useAi: z.boolean().optional() }).strict();
const SaveSchema = z.object({ kind: z.enum(DRAFT_KINDS), body: z.string().trim().min(1).max(6000) }).strict();

async function draftContext(requestId: string): Promise<DraftContext> {
  const { data: r } = await db()
    .from("requests")
    .select("id, request_type, amount_cents, complaint_status, welfare_status, booking_id, context, decision, status, matched_rule_id, policy_version, decision_reason, current_decision_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!r) throw new ApiError(404, "Request not found.");
  const { data: d } = await db().from("decisions").select("result").eq("id", r.current_decision_id).maybeSingle();
  const { data: ev } = await db().from("evidence_snapshots").select("records").eq("decision_id", r.current_decision_id).maybeSingle();
  const { data: owner } = await db()
    .from("request_events")
    .select("note")
    .eq("request_id", requestId)
    .in("event_type", ["owner_approved", "owner_declined", "owner_requested_info"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const result = (d?.result ?? null) as DecisionResult | null;
  const evidence = (ev?.records ?? null) as EvidenceSnapshot | null;
  const booking = evidence?.booking.status === "found" ? evidence.booking.record : null;
  const slot = evidence?.availability.status === "found" ? evidence.availability.record : null;
  return {
    requestId: r.id,
    requestType: r.request_type,
    amountCents: r.amount_cents,
    complaint: r.complaint_status,
    welfare: r.welfare_status,
    bookingId: r.booking_id,
    studentName: booking?.studentName ?? null,
    tutorName: booking?.tutorName ?? slot?.tutorName ?? null,
    subject: booking?.subject ?? null,
    slotText: slot
      ? new Date(slot.startsAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })
      : null,
    context: r.context,
    colour: r.decision,
    status: r.status as RequestStatus,
    matchedRuleId: r.matched_rule_id,
    policyVersion: r.policy_version,
    explanation: r.decision_reason,
    nextSteps: result?.nextSteps ?? [],
    missing: result ? [...result.missing.map((m) => m.message), ...result.blockers] : [],
    ownerNote: owner?.note ?? null,
  };
}

const AiDraftSchema = z.object({ body: z.string() });

export async function generateDraft(user: SessionUser, requestId: string, body: unknown) {
  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Unknown draft type.");
  const { kind } = parsed.data;
  const ctx = await draftContext(requestId);
  const template = templateDraft(kind, ctx);
  let text = template;
  let generatedBy: "template" | "live_ai" = "template";
  let note = "Template draft prepared from the saved facts.";
  let state: "completed" | "blocked" | "failed" = "completed";

  // Welfare cases never go to the AI provider: the restricted handover stays on our server.
  const aiAllowed = parsed.data.useAi && aiConfigured() && ctx.welfare !== "yes";
  if (parsed.data.useAi && ctx.welfare === "yes") note = "AI drafting is switched off for welfare cases. Template used.";
  if (parsed.data.useAi && !aiConfigured()) note = "AI is not configured. Template used.";

  if (aiAllowed) {
    const ai = await callStructured({
      schema: AiDraftSchema,
      maxTokens: 2000,
      system:
        "You rewrite draft messages for a small Australian tutoring business in plain, warm British English. Keep every fact exactly as given. Never promise a refund, booking change, approval or date that the facts do not say has happened. Never add new facts. Return only the message body.",
      user: redactForAi(
        `Draft type: ${DRAFT_LABELS[kind]}\nWorkflow status: ${ctx.status}\nDecision: ${ctx.colour}\nFacts and template to improve:\n${template}`,
      ),
    });
    if (ai.ok) {
      const promises = findUnsupportedPromises(ai.data.body, ctx.status);
      if (promises.length) {
        note = `The AI draft promised something that has not happened ("${promises[0]}"), so the template was kept.`;
        state = "blocked";
      } else {
        text = ai.data.body.trim().slice(0, 6000);
        generatedBy = "live_ai";
        note = `Draft written by live AI (${ai.model}) from the saved facts.`;
      }
    } else {
      note = `AI drafting failed (${ai.reason}). Template used instead.`;
      state = "failed";
    }
  }

  const { error } = await db()
    .from("drafts")
    .upsert(
      { request_id: requestId, kind, body: text, generated_by: generatedBy, updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: "request_id,kind" },
    );
  if (error) throw toDbError(error);
  await logActivity({
    sessionKey: crypto.randomUUID(), requestId, actorId: user.id,
    mode: generatedBy === "live_ai" ? "live_ai" : "system",
    eventType: "draft_prepared", state, summary: `${DRAFT_LABELS[kind]}: ${note}`,
  });
  return { kind, body: text, generatedBy, note };
}

export async function saveDraft(user: SessionUser, requestId: string, body: unknown) {
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Drafts must be between 1 and 6000 characters.");
  const { data: r } = await db().from("requests").select("status").eq("id", requestId).maybeSingle();
  if (!r) throw new ApiError(404, "Request not found.");
  const warnings = findUnsupportedPromises(parsed.data.body, r.status as RequestStatus);
  const { error } = await db()
    .from("drafts")
    .upsert(
      { request_id: requestId, kind: parsed.data.kind, body: parsed.data.body, generated_by: "edited", updated_by: user.id, updated_at: new Date().toISOString() },
      { onConflict: "request_id,kind" },
    );
  if (error) throw toDbError(error);
  return { saved: true, warnings };
}

export type { DraftKind };
