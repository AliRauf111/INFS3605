import { z } from "zod";
import { REQUEST_TYPES, TRI_STATES } from "@/lib/domain/types";
import { MAX_AMOUNT_CENTS, parseAmountToCents } from "@/lib/domain/money";

// One set of validation rules used by both the wizard and the AI intake. The browser
// may check things early for convenience, but only these server-side checks count.

const tri = z.enum(TRI_STATES).nullable();
const reference = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/, "References use letters, numbers and dashes, for example BK-1042.")
  .transform((s) => s.toUpperCase());

/** Facts after the person has confirmed them. This is what the decision engine sees. */
export const ConfirmedFactsSchema = z
  .object({
    requestType: z.enum(REQUEST_TYPES),
    moneyInvolved: tri,
    amountCents: z.number().int().min(0).max(MAX_AMOUNT_CENTS).nullable(),
    complaint: tri,
    welfare: tri,
    referenceId: reference.nullable(),
    bookingId: reference.nullable(),
    financialImpact: tri,
    proposedSlotId: reference.nullable(),
    extensionDays: z.number().int().min(1).max(120).nullable(),
    context: z.string().max(2000),
  })
  .strict();

export type ConfirmedFacts = z.infer<typeof ConfirmedFactsSchema>;

/** What the wizard and the intake review screen post. Amount arrives as typed text. */
export const FactsFormSchema = z
  .object({
    requestType: z.enum(REQUEST_TYPES),
    moneyInvolved: tri.optional().default(null),
    amount: z.string().max(30).nullable().optional().default(null),
    complaint: tri.optional().default(null),
    welfare: tri.optional().default(null),
    referenceId: z.string().max(40).nullable().optional().default(null),
    bookingId: z.string().max(40).nullable().optional().default(null),
    financialImpact: tri.optional().default(null),
    proposedSlotId: z.string().max(40).nullable().optional().default(null),
    extensionDays: z.string().max(5).nullable().optional().default(null),
    context: z.string().max(2000).optional().default(""),
  })
  .strict();

export type FactsForm = z.input<typeof FactsFormSchema>;

export type ValidationResult =
  | { ok: true; facts: ConfirmedFacts }
  | { ok: false; errors: Record<string, string> };

function emptyToNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Validate a submitted form and turn it into confirmed facts.
 * Malformed values are rejected. Missing values become null, which later blocks green.
 */
export function validateFactsForm(input: unknown): ValidationResult {
  const parsed = FactsFormSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      errors[String(issue.path[0] ?? "form")] = issue.message;
    }
    return { ok: false, errors };
  }
  const f = parsed.data;
  const errors: Record<string, string> = {};

  const amount = parseAmountToCents(f.amount);
  if (!amount.ok) errors.amount = amount.error;

  let extensionDays: number | null = null;
  const ext = emptyToNull(f.extensionDays);
  if (ext !== null) {
    if (!/^\d{1,3}$/.test(ext) || Number(ext) < 1 || Number(ext) > 120) {
      errors.extensionDays = "Enter a whole number of days from 1 to 120.";
    } else {
      extensionDays = Number(ext);
    }
  }

  const amountCents = amount.ok ? amount.cents : null;
  if (f.moneyInvolved === "no" && amountCents !== null && amountCents > 0) {
    errors.amount = "You said no money is involved, but entered an amount. Change one of these answers.";
  }

  const candidate = {
    requestType: f.requestType,
    moneyInvolved: f.moneyInvolved,
    amountCents,
    complaint: f.complaint,
    welfare: f.welfare,
    referenceId: emptyToNull(f.referenceId),
    bookingId: emptyToNull(f.bookingId),
    financialImpact: f.requestType === "lesson_change" ? f.financialImpact : null,
    proposedSlotId: f.requestType === "lesson_change" ? emptyToNull(f.proposedSlotId) : null,
    extensionDays: f.requestType === "payment_extension" ? extensionDays : null,
    context: f.context.trim(),
  };

  const strict = ConfirmedFactsSchema.safeParse(candidate);
  if (!strict.success) {
    for (const issue of strict.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!errors[key]) errors[key] = issue.message;
    }
  }
  if (Object.keys(errors).length > 0 || !strict.success) return { ok: false, errors };
  return { ok: true, facts: strict.data };
}

export const SubmitRequestSchema = z
  .object({
    idempotencyKey: z.uuid(),
    intakeMethod: z.enum(["wizard", "ai_intake"]),
    facts: z.unknown(),
  })
  .strict();
