import { enT, type Translate } from "@/lib/i18n/core";
import { makeFormat, type Format } from "@/lib/i18n/format";
import { z } from "zod";
import { ACTIONS, COLOURS } from "@/lib/domain/types";
import { MAX_AMOUNT_CENTS } from "@/lib/domain/money";

// The owner's rules are stored as data in this shape, not as code. The rule builder
// only offers these supported conditions, so an owner cannot write arbitrary logic.

export const POLICY_CATEGORIES = ["refund", "lesson_change", "payment_extension"] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

export const FACT_KEYS = [
  "amount",
  "complaint",
  "welfare",
  "reference",
  "payment_record",
  "financial_impact",
  "availability",
  "extension_days",
  "outstanding_invoice",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export const FACT_LABELS: Record<FactKey, string> = {
  amount: "Refund amount in AUD",
  complaint: "Complaint status",
  welfare: "Child welfare status",
  reference: "Booking reference matched to one booking",
  payment_record: "Matching payment record with no conflicts",
  financial_impact: "Whether the change affects fees",
  availability: "Tutor availability for the new time",
  extension_days: "Number of extra days requested",
  outstanding_invoice: "An unpaid invoice on record",
};

type CategoryConfig = {
  label: string;
  numeric: null | { fact: "amountCents" | "extensionDays"; label: string; unit: "cents" | "days"; max: number };
  usesFinancialImpact: boolean;
  allowedFacts: FactKey[];
  /** Facts a green rule cannot do without. Activation is blocked if they are not required. */
  greenNeeds: FactKey[];
};

export const CATEGORY_CONFIG: Record<PolicyCategory, CategoryConfig> = {
  refund: {
    label: "Refunds",
    numeric: { fact: "amountCents", label: "Refund amount", unit: "cents", max: MAX_AMOUNT_CENTS },
    usesFinancialImpact: false,
    allowedFacts: ["amount", "complaint", "welfare", "reference", "payment_record"],
    greenNeeds: ["amount", "complaint", "welfare", "reference", "payment_record"],
  },
  lesson_change: {
    label: "Lesson changes",
    numeric: null,
    usesFinancialImpact: true,
    allowedFacts: ["complaint", "welfare", "reference", "financial_impact", "availability"],
    greenNeeds: ["complaint", "welfare", "reference", "financial_impact", "availability"],
  },
  payment_extension: {
    label: "Payment extensions",
    numeric: { fact: "extensionDays", label: "Extra days requested", unit: "days", max: 120 },
    usesFinancialImpact: false,
    allowedFacts: ["complaint", "welfare", "reference", "extension_days", "outstanding_invoice"],
    greenNeeds: ["complaint", "welfare", "reference", "extension_days", "outstanding_invoice"],
  },
};

export function formatNumeric(category: PolicyCategory, value: number, t: Translate = enT, f: Format = makeFormat()): string {
  const n = CATEGORY_CONFIG[category].numeric;
  if (!n) return String(value);
  return n.unit === "cents" ? f.money(value) : t("rules.range.days", { count: value });
}

export const RangeSchema = z
  .object({
    min: z.number().int().min(0).nullable(),
    max: z.number().int().min(0).nullable(),
    // true means "up to and including max", false means "below max"
    maxInclusive: z.boolean(),
  })
  .strict();
export type Range = z.infer<typeof RangeSchema>;

export const RuleSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.-]{1,59}$/, "Rule IDs use lower-case letters, numbers, dots and dashes."),
    label: z.string().trim().min(1, "Give the rule a short name.").max(120),
    range: RangeSchema.nullable(),
    financialImpact: z.enum(["yes", "no"]).nullable(),
    colour: z.enum(COLOURS),
    permittedActions: z.array(z.enum(ACTIONS)).max(ACTIONS.length),
    nextSteps: z.array(z.string().trim().min(1).max(300)).max(10),
    escalation: z.string().trim().max(500),
  })
  .strict();
export type Rule = z.infer<typeof RuleSchema>;

export const PolicyDefinitionSchema = z
  .object({
    category: z.enum(POLICY_CATEGORIES),
    title: z.string().trim().min(1).max(120),
    requiredFacts: z.array(z.enum(FACT_KEYS)).max(FACT_KEYS.length),
    rules: z.array(RuleSchema).min(1, "Add at least one rule.").max(20),
  })
  .strict();
export type PolicyDefinition = z.infer<typeof PolicyDefinitionSchema>;

/** A policy version as the engine sees it: a frozen copy, never a live reference. */
export type PolicySnapshot = {
  id: string;
  category: PolicyCategory;
  version: number;
  status: "draft" | "active" | "archived";
  definition: PolicyDefinition;
};

export function policyVersionLabel(p: Pick<PolicySnapshot, "category" | "version">): string {
  return `${p.category}-v${p.version}`;
}

/** Turn a range into a closed whole-number interval [lo, hi]. hi may be Infinity. */
export function toInterval(range: Range | null): [number, number] {
  if (!range) return [0, Infinity];
  const lo = range.min ?? 0;
  let hi = range.max === null ? Infinity : range.max;
  if (range.max !== null && !range.maxInclusive) hi = range.max - 1;
  return [lo, hi];
}

export function describeRange(category: PolicyCategory, range: Range | null, t: Translate = enT, f: Format = makeFormat()): string {
  if (!range || (range.min === null && range.max === null)) return t("rules.range.any");
  const fmt = (v: number) => formatNumeric(category, v, t, f);
  const low = range.min !== null && range.min > 0 ? fmt(range.min) : null;
  if (range.max === null) return low ? t("rules.range.orMore", { low }) : t("rules.range.any");
  const high = fmt(range.max);
  if (low) return range.maxInclusive ? t("rules.range.fromUpTo", { low, high }) : t("rules.range.fromBelow", { low, high });
  return range.maxInclusive ? t("rules.range.upTo", { high }) : t("rules.range.below", { high });
}

/** The label for a request category, in the reader's language. CATEGORY_CONFIG keeps the English. */
export function categoryLabel(category: PolicyCategory, t: Translate = enT): string {
  return t(`rules.category.${category}`);
}

/** The words for a fact a green rule needs. FACT_LABELS keeps the English. */
export function factLabel(fact: FactKey, t: Translate = enT): string {
  return t(`rules.fact.${fact}`);
}
