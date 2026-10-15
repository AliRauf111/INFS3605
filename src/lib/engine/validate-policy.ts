import type { ConfirmedFacts } from "@/lib/validation/facts";
import type { EvidenceSnapshot } from "./evidence";
import { evaluate } from "./evaluate";
import {
  CATEGORY_CONFIG,
  FACT_LABELS,
  PolicyDefinitionSchema,
  type PolicyDefinition,
  type PolicySnapshot,
  formatNumeric,
  toInterval,
} from "./policy";

// Checks an owner's draft policy before it can be activated. Errors block activation.
// Warnings are shown to the owner, who can still activate after reading them.

export type PolicyIssue = { level: "error" | "warning"; message: string; ruleIds?: string[] };

export type BoundaryCase = {
  label: string;
  value: number;
  financialImpact: "yes" | "no" | null;
  colour: string;
  matchedRuleId: string;
};

export type PolicyCheck = {
  ok: boolean;
  issues: PolicyIssue[];
  boundaryCases: BoundaryCase[];
  definition: PolicyDefinition | null;
};

function fmtInterval(def: PolicyDefinition, lo: number, hi: number): string {
  const f = (v: number) => formatNumeric(def.category, v);
  if (hi === Infinity) return `${f(lo)} and above`;
  if (lo === hi) return f(lo);
  return `${f(lo)} to ${f(hi)}`;
}

function impactCompatible(a: "yes" | "no" | null, b: "yes" | "no" | null) {
  return a === null || b === null || a === b;
}

export function validatePolicy(input: unknown): PolicyCheck {
  const parsed = PolicyDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      definition: null,
      boundaryCases: [],
      issues: parsed.error.issues.map((i) => ({
        level: "error" as const,
        message: `${i.path.join(" > ") || "Policy"}: ${i.message}`,
      })),
    };
  }
  const def = parsed.data;
  const config = CATEGORY_CONFIG[def.category];
  const issues: PolicyIssue[] = [];

  // Required facts must be ones this category supports.
  for (const f of def.requiredFacts) {
    if (!config.allowedFacts.includes(f)) {
      issues.push({ level: "error", message: `"${FACT_LABELS[f]}" does not apply to ${config.label.toLowerCase()}.` });
    }
  }

  const ids = new Set<string>();
  const intervals = def.rules.map((r) => toInterval(r.range));

  def.rules.forEach((rule, i) => {
    if (ids.has(rule.id)) issues.push({ level: "error", message: `Two rules share the ID "${rule.id}".`, ruleIds: [rule.id] });
    ids.add(rule.id);

    if (rule.range && !config.numeric) {
      issues.push({ level: "error", message: `"${rule.label}" sets a threshold, but ${config.label.toLowerCase()} have no amount to compare.`, ruleIds: [rule.id] });
    }
    if (rule.range && config.numeric) {
      const { min, max } = rule.range;
      if ((min !== null && min > config.numeric.max) || (max !== null && max > config.numeric.max)) {
        issues.push({ level: "error", message: `"${rule.label}" uses a threshold above the allowed maximum.`, ruleIds: [rule.id] });
      }
    }
    if (rule.financialImpact && !config.usesFinancialImpact) {
      issues.push({ level: "error", message: `"${rule.label}" checks fees, which only applies to lesson changes.`, ruleIds: [rule.id] });
    }
    const [lo, hi] = intervals[i];
    if (lo > hi) {
      issues.push({
        level: "error",
        message: `"${rule.label}" can never match: its lower limit is above its upper limit.`,
        ruleIds: [rule.id],
      });
    }
    if (rule.colour === "green") {
      const lacking = config.greenNeeds.filter((f) => !def.requiredFacts.includes(f));
      if (lacking.length) {
        issues.push({
          level: "error",
          message: `"${rule.label}" is green, so these checks must be required: ${lacking.map((f) => FACT_LABELS[f]).join(", ")}.`,
          ruleIds: [rule.id],
        });
      }
      if (rule.nextSteps.length === 0) {
        issues.push({ level: "error", message: `"${rule.label}" is green but has no approved steps for the admin to follow.`, ruleIds: [rule.id] });
      }
    }
    if (rule.colour !== "green" && !rule.escalation) {
      issues.push({ level: "warning", message: `"${rule.label}" has no escalation instructions.`, ruleIds: [rule.id] });
    }
  });

  // Overlaps: two rules that could both match the same facts make the result depend on order.
  for (let i = 0; i < def.rules.length; i++) {
    for (let j = i + 1; j < def.rules.length; j++) {
      const a = def.rules[i];
      const b = def.rules[j];
      if (!impactCompatible(a.financialImpact, b.financialImpact)) continue;
      const lo = Math.max(intervals[i][0], intervals[j][0]);
      const hi = Math.min(intervals[i][1], intervals[j][1]);
      if (lo <= hi) {
        const where = config.numeric ? ` for ${fmtInterval(def, lo, hi)}` : "";
        issues.push({
          level: "error",
          message: `"${a.label}" and "${b.label}" overlap${where}. Each case must match only one rule.`,
          ruleIds: [a.id, b.id],
        });
      }
    }
  }

  // Gaps: values no rule covers. These fall to the default amber route, which is safe,
  // but the owner should know about them.
  const impactValues: Array<"yes" | "no" | null> = config.usesFinancialImpact ? ["yes", "no"] : [null];
  for (const impact of impactValues) {
    const covering = def.rules
      .map((r, i) => ({ r, iv: intervals[i] }))
      .filter(({ r, iv }) => (impact === null || r.financialImpact === null || r.financialImpact === impact) && iv[0] <= iv[1])
      .map(({ iv }) => iv)
      .sort((x, y) => x[0] - y[0]);
    let cursor = 0;
    const gaps: Array<[number, number]> = [];
    for (const [lo, hi] of covering) {
      if (lo > cursor) gaps.push([cursor, lo - 1]);
      cursor = Math.max(cursor, hi === Infinity ? Infinity : hi + 1);
      if (cursor === Infinity) break;
    }
    if (cursor !== Infinity) gaps.push([cursor, Infinity]);
    for (const [lo, hi] of gaps) {
      const what = config.numeric
        ? `${config.numeric.label} ${fmtInterval(def, lo, hi)}`
        : impact === "yes"
          ? "Changes that affect fees"
          : "Changes that do not affect fees";
      issues.push({
        level: "warning",
        message: `${what}: no rule covers this, so it will follow the default amber route.`,
      });
    }
  }

  const hasErrors = issues.some((i) => i.level === "error");
  return {
    ok: !hasErrors,
    issues,
    definition: def,
    boundaryCases: hasErrors ? [] : boundaryCases(def),
  };
}

/** Sample facts where every required check passes, used for boundary cases and the test area. */
export function sampleFacts(def: PolicyDefinition, overrides: Partial<ConfirmedFacts> = {}): ConfirmedFacts {
  return {
    requestType: def.category,
    moneyInvolved: def.category === "refund" ? "yes" : "no",
    amountCents: def.category === "refund" ? 1000 : null,
    complaint: "no",
    welfare: "no",
    referenceId: "SAMPLE-1",
    bookingId: "SAMPLE-1",
    financialImpact: def.category === "lesson_change" ? "no" : null,
    proposedSlotId: def.category === "lesson_change" ? "SLOT-SAMPLE" : null,
    extensionDays: def.category === "payment_extension" ? 7 : null,
    context: "",
    ...overrides,
  };
}

/** Evidence where every record is found, current and consistent. Labelled as a sample in the UI. */
export function sampleEvidence(def: PolicyDefinition, facts: ConfirmedFacts): EvidenceSnapshot {
  const now = "2026-01-01T00:00:00.000Z";
  const paid = Math.max(facts.amountCents ?? 0, 100000);
  return {
    retrievedAt: now,
    booking: {
      status: "found",
      record: {
        id: "SAMPLE-1", familyId: "FAM-SAMPLE", studentName: "Sample student", tutorId: "T-SAMPLE",
        tutorName: "Sample tutor", subject: "Sample subject", lessonsPurchased: 10, lessonsUsed: 2,
        priceCents: paid, status: "active", dataLabel: "fictional_demo", lastSyncedAt: now, stale: false,
      },
    },
    payments: {
      status: "checked",
      records: [
        {
          id: "PAY-SAMPLE", bookingId: "SAMPLE-1", invoiceRef: "INV-SAMPLE", amountCents: paid,
          status: def.category === "payment_extension" ? "pending" : "paid", paidAt: now, dueDate: now,
          dataLabel: "fictional_demo", lastSyncedAt: now, stale: false,
        },
      ],
    },
    availability:
      def.category === "lesson_change"
        ? {
            status: "found",
            record: {
              id: "SLOT-SAMPLE", tutorId: "T-SAMPLE", tutorName: "Sample tutor", startsAt: now, endsAt: now,
              status: "free", dataLabel: "fictional_demo", lastSyncedAt: now, stale: false,
            },
          }
        : { status: "not_checked" },
  };
}

function boundaryCases(def: PolicyDefinition): BoundaryCase[] {
  const config = CATEGORY_CONFIG[def.category];
  const snapshot: PolicySnapshot = { id: "draft", category: def.category, version: 0, status: "draft", definition: def };
  const cases: BoundaryCase[] = [];

  if (config.numeric) {
    const points = new Set<number>();
    for (const r of def.rules) {
      const [lo, hi] = toInterval(r.range);
      for (const v of [lo - 1, lo, hi, hi + 1]) if (Number.isFinite(v) && v >= 0 && v <= config.numeric.max) points.add(v);
    }
    const values = [...points].sort((a, b) => a - b).slice(0, 14);
    for (const value of values) {
      const facts = sampleFacts(def, { [config.numeric.fact]: value } as Partial<ConfirmedFacts>);
      const r = evaluate({ facts, evidence: sampleEvidence(def, facts), policy: snapshot });
      cases.push({ label: formatNumeric(def.category, value), value, financialImpact: null, colour: r.colour, matchedRuleId: r.matchedRuleId });
    }
  } else if (config.usesFinancialImpact) {
    for (const impact of ["no", "yes"] as const) {
      const facts = sampleFacts(def, { financialImpact: impact });
      const r = evaluate({ facts, evidence: sampleEvidence(def, facts), policy: snapshot });
      cases.push({
        label: impact === "no" ? "No effect on fees, tutor free" : "Affects fees, tutor free",
        value: 0, financialImpact: impact, colour: r.colour, matchedRuleId: r.matchedRuleId,
      });
    }
  }
  return cases;
}
