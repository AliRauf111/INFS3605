import "server-only";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/session";
import { db, toDbError } from "@/lib/db/supabase";
import { ApiError } from "@/lib/api/handler";
import { aiConfigured, callStructured } from "@/lib/ai/client";
import { logActivity } from "@/lib/agent/activity";
import { evaluate } from "@/lib/engine/evaluate";
import {
  CATEGORY_CONFIG,
  POLICY_CATEGORIES,
  PolicyDefinitionSchema,
  type PolicyCategory,
  type PolicyDefinition,
  type PolicySnapshot,
} from "@/lib/engine/policy";
import { sampleEvidence, sampleFacts, validatePolicy } from "@/lib/engine/validate-policy";
import { validateFactsForm } from "@/lib/validation/facts";
import { ACTIONS, COLOURS } from "@/lib/domain/types";
import { describeRuleSimulated } from "./describe-rule-logic";

// Owner rule builder actions. Every function that changes rules checks for the owner
// role here, and the database functions check again.

function requireOwner(user: SessionUser) {
  if (user.role !== "owner") throw new ApiError(403, "Only the owner can change rules.");
}

const CreateSchema = z
  .object({
    category: z.enum(POLICY_CATEGORIES),
    copyFromId: z.uuid().optional(),
    definition: z.unknown().optional(),
    note: z.string().max(1000).optional(),
    source: z.enum(["owner", "ai_proposal", "suggestion"]).optional(),
  })
  .strict();

export async function createPolicyDraft(user: SessionUser, body: unknown) {
  requireOwner(user);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Invalid draft request.");
  let definition: unknown = parsed.data.definition;
  if (parsed.data.copyFromId) {
    const { data } = await db().from("policy_versions").select("definition, category").eq("id", parsed.data.copyFromId).maybeSingle();
    if (!data || data.category !== parsed.data.category) throw new ApiError(404, "Version to copy was not found.");
    definition = data.definition;
  }
  const shape = PolicyDefinitionSchema.safeParse(definition);
  if (!shape.success || shape.data.category !== parsed.data.category) {
    throw new ApiError(400, "The draft is not a valid rule set.", shape.success ? undefined : shape.error.issues.map((i) => i.message));
  }
  const { data, error } = await db().rpc("create_policy_draft", {
    p_actor: user.id,
    p_category: parsed.data.category,
    p_definition: shape.data,
    p_note: parsed.data.note ?? "",
    p_source: parsed.data.source ?? "owner",
  });
  if (error) throw toDbError(error);
  return data as { id: string; version: number };
}

const UpdateSchema = z.object({ definition: z.unknown(), note: z.string().max(1000).optional() }).strict();

export async function updatePolicyDraft(user: SessionUser, id: string, body: unknown) {
  requireOwner(user);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Invalid update.");
  const shape = PolicyDefinitionSchema.safeParse(parsed.data.definition);
  if (!shape.success) throw new ApiError(400, "The draft is not a valid rule set.", shape.error.issues.map((i) => `${i.path.join(" > ")}: ${i.message}`));
  const { data, error } = await db()
    .from("policy_versions")
    .update({ definition: shape.data, change_note: parsed.data.note ?? "" })
    .eq("id", id)
    .eq("status", "draft")
    .eq("category", shape.data.category)
    .select("id")
    .maybeSingle();
  if (error) throw toDbError(error);
  if (!data) throw new ApiError(409, "Only draft versions can be edited. Create a new draft from this version instead.");
  await db().from("audit_events").insert({ actor_id: user.id, actor_role: "owner", action: "policy.update_draft", entity_type: "policy_version", entity_id: id, detail: {} });
  return { id, check: validatePolicy(shape.data) };
}

export async function deletePolicyDraft(user: SessionUser, id: string) {
  requireOwner(user);
  const { data: used } = await db().from("rule_suggestions").select("id").eq("draft_policy_version_id", id).limit(1);
  if (used?.length) await db().from("rule_suggestions").update({ draft_policy_version_id: null, status: "open" }).eq("draft_policy_version_id", id);
  const { data, error } = await db().from("policy_versions").delete().eq("id", id).eq("status", "draft").select("id").maybeSingle();
  if (error) throw toDbError(error);
  if (!data) throw new ApiError(409, "Only drafts can be deleted.");
  await db().from("audit_events").insert({ actor_id: user.id, actor_role: "owner", action: "policy.delete_draft", entity_type: "policy_version", entity_id: id, detail: {} });
  return { deleted: true };
}

const ActivateSchema = z.object({ note: z.string().trim().min(1, "Say why you are activating this version.").max(1000), acknowledgeWarnings: z.boolean() }).strict();

export async function activatePolicy(user: SessionUser, id: string, body: unknown) {
  requireOwner(user);
  const parsed = ActivateSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request.");
  const { data: row } = await db().from("policy_versions").select("definition, status").eq("id", id).maybeSingle();
  if (!row) throw new ApiError(404, "Version not found.");
  const check = validatePolicy(row.definition);
  if (!check.ok) throw new ApiError(400, "This draft has errors that must be fixed before activation.", check.issues);
  if (check.issues.some((i) => i.level === "warning") && !parsed.data.acknowledgeWarnings) {
    throw new ApiError(400, "Read and acknowledge the warnings before activating.", check.issues);
  }
  const { data, error } = await db().rpc("activate_policy_version", { p_version_id: id, p_actor: user.id, p_note: parsed.data.note });
  if (error) throw toDbError(error);
  return data;
}

export function checkPolicy(body: unknown) {
  const parsed = z.object({ definition: z.unknown() }).safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Invalid request.");
  return validatePolicy(parsed.data.definition);
}

/** Sample-request test area. Uses sample evidence where every record is found and consistent. */
export function testPolicy(body: unknown) {
  const parsed = z.object({ definition: z.unknown(), facts: z.unknown() }).safeParse(body);
  if (!parsed.success) throw new ApiError(400, "Invalid request.");
  const def = PolicyDefinitionSchema.safeParse(parsed.data.definition);
  if (!def.success) throw new ApiError(400, "Fix the rule set before testing it.");
  const facts = validateFactsForm(parsed.data.facts);
  if (!facts.ok) throw new ApiError(400, "Some sample answers are invalid.", facts.errors);
  if (facts.facts.requestType !== def.data.category) throw new ApiError(400, "The sample must be the same request type as the rule set.");
  const merged = {
    ...sampleFacts(def.data),
    ...facts.facts,
    referenceId: "SAMPLE-1",
    bookingId: "SAMPLE-1",
    proposedSlotId: def.data.category === "lesson_change" ? "SLOT-SAMPLE" : null,
  };
  const snapshot: PolicySnapshot = { id: "draft-test", category: def.data.category, version: 0, status: "draft", definition: def.data };
  return evaluate({ facts: merged, evidence: sampleEvidence(def.data, merged), policy: snapshot });
}

// "Describe a Rule" -----------------------------------------------------------------

// A looser shape for the model's answer. The server tidies it and the full validator
// checks it, so the AI cannot produce an activatable rule on its own.
const AiRuleSchema = z.object({
  label: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  maxInclusive: z.boolean(),
  financialImpact: z.enum(["yes", "no", "any"]),
  colour: z.enum(COLOURS),
  nextSteps: z.array(z.string()),
  escalation: z.string(),
});
const AiProposalSchema = z.object({
  title: z.string(),
  rules: z.array(AiRuleSchema),
  ambiguities: z.array(z.string()).describe("Unclear wording, missing cases and boundary questions the owner must decide"),
});

const DescribeSchema = z.object({ category: z.enum(POLICY_CATEGORIES), instruction: z.string().trim().min(10).max(2000) }).strict();

function tidyProposal(category: PolicyCategory, p: z.infer<typeof AiProposalSchema>): PolicyDefinition {
  const config = CATEGORY_CONFIG[category];
  const toUnits = (v: number | null) => (v === null ? null : config.numeric?.unit === "cents" ? Math.round(v * 100) : Math.round(v));
  return {
    category,
    title: (p.title || `${config.label} rules`).slice(0, 120),
    requiredFacts: [...config.greenNeeds],
    rules: p.rules.slice(0, 20).map((r, i) => ({
      id: `${category}.rule_${i + 1}`,
      label: (r.label || `Rule ${i + 1}`).slice(0, 120),
      range: config.numeric && (r.min !== null || r.max !== null) ? { min: toUnits(r.min), max: toUnits(r.max), maxInclusive: r.maxInclusive } : null,
      financialImpact: config.usesFinancialImpact && r.financialImpact !== "any" ? r.financialImpact : null,
      colour: r.colour,
      permittedActions: r.colour === "green" ? ["prepare_parent_response", "prepare_admin_checklist"] : ["prepare_parent_response", "prepare_escalation_summary", "send_to_owner"],
      nextSteps: r.nextSteps.filter((s) => s.trim()).slice(0, 10).map((s) => s.slice(0, 300)),
      escalation: r.escalation.slice(0, 500),
    })),
  };
}

export async function describeRule(user: SessionUser, body: unknown) {
  requireOwner(user);
  const parsed = DescribeSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Describe the rule in a sentence or two.");
  const { category, instruction } = parsed.data;
  const config = CATEGORY_CONFIG[category];
  let mode: "live_ai" | "simulated" = "simulated";
  let modeNote = "Simulated proposal: a simple pattern reader, no AI. Set ANTHROPIC_API_KEY for live AI.";
  let proposal = describeRuleSimulated(category, instruction);

  if (aiConfigured()) {
    const unit = config.numeric ? (config.numeric.unit === "cents" ? "AUD dollars (e.g. 49.99)" : "whole days") : "not used";
    const ai = await callStructured({
      schema: AiProposalSchema,
      system: `You turn a tutoring business owner's plain-English rule into a structured draft for ${config.label.toLowerCase()}.
Thresholds (min, max) are in ${unit}. min is inclusive. maxInclusive says whether max itself is included. Use null for no limit.
${config.usesFinancialImpact ? 'financialImpact is "yes", "no" or "any" (whether the change affects fees).' : 'Set financialImpact to "any".'}
colour: green = admin may proceed, amber = clarify or get owner approval, red = owner only.
List every ambiguity: unclear boundaries (is the threshold itself included?), cases the instruction does not cover, and conflicting statements.
You only draft. The owner edits, tests and activates rules. Complaint and welfare concerns are always red regardless of these rules.`,
      user: `<instruction>\n${instruction}\n</instruction>`,
    });
    if (ai.ok) {
      proposal = { definition: tidyProposal(category, ai.data), ambiguities: ai.data.ambiguities.slice(0, 10) };
      mode = "live_ai";
      modeNote = `Proposal drafted by live AI (${ai.model}).`;
    } else {
      modeNote = `Live AI was unavailable (${ai.reason}). Showing the simulated proposal instead.`;
    }
  }
  const check = validatePolicy(proposal.definition);
  await logActivity({
    sessionKey: crypto.randomUUID(), actorId: user.id, mode, eventType: "rule_proposed", state: "completed",
    summary: `Draft rule proposed for ${config.label.toLowerCase()} with ${proposal.definition.rules.length} rule(s). Not active.`,
  });
  return { mode, modeNote, definition: proposal.definition, ambiguities: proposal.ambiguities, check };
}

export { ACTIONS };
