import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/handler";
import { logActivity } from "@/lib/agent/activity";
import { aiConfigured, callStructured, redactForAi } from "./client";
import { EXTRACTION_SYSTEM, ExtractionSchema, groundExtraction, simulatedExtraction } from "./intake-logic";

const IntakeSchema = z.object({ sessionKey: z.uuid(), message: z.string().trim().min(10, "Paste a longer message.").max(4000) }).strict();

/**
 * AI-assisted intake. Returns editable suggestions only. Nothing is evaluated or saved
 * until the admin confirms the facts and submits them through the same path as the wizard.
 */
export async function extractFromMessage(user: SessionUser, body: unknown) {
  const parsed = IntakeSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid message.");
  const { sessionKey, message } = parsed.data;

  let mode: "live_ai" | "simulated" = "simulated";
  let modeNote = "Simulated extraction: keyword rules, no AI. Set ANTHROPIC_API_KEY to use live AI.";
  let raw = simulatedExtraction(message);

  if (aiConfigured()) {
    const ai = await callStructured({
      schema: ExtractionSchema,
      system: EXTRACTION_SYSTEM,
      // Delimiters make it clear where the untrusted message starts and ends.
      user: `Extract the facts from this message.\n<message>\n${redactForAi(message)}\n</message>`,
    });
    if (ai.ok) {
      raw = ai.data;
      mode = "live_ai";
      modeNote = `Live AI extraction (${ai.model}).`;
    } else {
      modeNote = `Live AI was unavailable (${ai.reason}). Showing simulated extraction instead.`;
      await logActivity({ sessionKey, actorId: user.id, mode: "system", eventType: "ai_unavailable", state: "failed", summary: ai.reason });
    }
  }

  const grounded = groundExtraction(raw, message);
  await logActivity([
    {
      sessionKey, actorId: user.id, mode, eventType: "details_extracted", state: "completed",
      summary: `${mode === "live_ai" ? "AI" : "Simulated rules"} suggested: ${grounded.suggestion.requestType ?? "type unclear"}${grounded.suggestion.amount ? `, $${grounded.suggestion.amount}` : ""}${grounded.suggestion.referenceId ? `, ${grounded.suggestion.referenceId}` : ""}.`,
      detail: { excerpts: grounded.excerpts.slice(0, 6), dropped: grounded.dropped },
    },
    ...(grounded.questions.length
      ? [{
          sessionKey, actorId: user.id, mode: "system" as const, eventType: "clarification_needed" as const, state: "blocked" as const,
          summary: `${grounded.questions.length} question${grounded.questions.length > 1 ? "s" : ""} to confirm before evaluation.`,
          detail: { questions: grounded.questions },
        }]
      : []),
    {
      sessionKey, actorId: user.id, mode: "system", eventType: "confirmation_required", state: "pending",
      summary: "Waiting for the admin to confirm the facts. Nothing is evaluated until then.",
    },
  ]);
  return { mode, modeNote, ...grounded };
}
