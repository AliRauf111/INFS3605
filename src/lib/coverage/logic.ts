import type { Colour, RequestType } from "@/lib/domain/types";
import { formatAud } from "@/lib/domain/money";
import { CATEGORY_CONFIG, type PolicyCategory, type PolicyDefinition, formatNumeric, toInterval } from "@/lib/engine/policy";
import { validatePolicy } from "@/lib/engine/validate-policy";

// Coverage metrics and rule suggestions, calculated only from saved records.

export type CoverageRequest = {
  id: string;
  request_type: RequestType;
  decision: Colour;
  matched_rule_id: string;
  status: string;
  amount_cents: number | null;
  complaint_status: string | null;
  welfare_status: string | null;
  confirmed_facts: { extensionDays?: number | null } | null;
  created_at: string;
  missing: Array<{ fact: string; message: string }>;
  ownerApproved: boolean;
};

export const RULE_REASON_LABELS: Record<string, string> = {
  "default.missing_information": "Missing or uncertain information",
  "default.unsupported": "Request type not covered by any policy",
  "default.missing_policy": "No active policy for this request type",
  "default.no_matching_rule": "No rule covers these facts (a gap)",
  "safety.complaint": "Confirmed complaint",
  "safety.welfare": "Confirmed welfare concern",
};

export const FACT_TEXT: Record<string, string> = {
  amount: "Refund amount",
  complaint: "Complaint status",
  welfare: "Welfare status",
  reference: "Booking reference",
  payment_record: "Payment record",
  financial_impact: "Fee impact",
  availability: "Tutor availability",
  extension_days: "Extension length",
  outstanding_invoice: "Unpaid invoice",
  policy: "Active policy",
  request_type: "Supported request type",
};

const isOwnerRule = (rule: string) => !rule.startsWith("default.") && !rule.startsWith("safety.");

export function computeCoverage(rows: CoverageRequest[]) {
  const total = rows.length;
  const byCategory = new Map<string, Record<Colour, number>>();
  for (const r of rows) {
    const c = byCategory.get(r.request_type) ?? { green: 0, amber: 0, red: 0 };
    c[r.decision] += 1;
    byCategory.set(r.request_type, c);
  }
  const count = <T,>(items: T[], key: (t: T) => string) => {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const amber = rows.filter((r) => r.decision === "amber");
  const amberReasons = count(amber, (r) => r.matched_rule_id);
  const missingFacts = count(rows.flatMap((r) => r.missing.map((m) => ({ fact: m.fact }))), (m) => m.fact);
  const awaitingOwner = rows.filter((r) => r.status === "awaiting_owner").length;
  const overrides = count(
    rows.filter((r) => r.ownerApproved && r.decision !== "green"),
    (r) => r.matched_rule_id,
  );
  const withinPolicy = rows.filter((r) => isOwnerRule(r.matched_rule_id)).length;
  const green = rows.filter((r) => r.decision === "green").length;
  return {
    total,
    byCategory: [...byCategory.entries()],
    amberReasons,
    missingFacts,
    awaitingOwner,
    overrides,
    withinPolicy,
    withinPolicyShare: total ? withinPolicy / total : 0,
    green,
    greenShare: total ? green / total : 0,
  };
}

export type SuggestionProposal = {
  patternKey: string;
  category: PolicyCategory;
  summary: string;
  requestIds: string[];
  definition: PolicyDefinition;
};

/**
 * Look for repeated owner approvals of the same non-green rule, with no complaint or
 * welfare concern, and suggest widening the green band to cover them. The suggestion is
 * only a draft: the owner reviews, edits, tests and activates it, or dismisses it.
 */
export function suggestRules(rows: CoverageRequest[], active: Record<string, PolicyDefinition | undefined>): SuggestionProposal[] {
  const groups = new Map<string, CoverageRequest[]>();
  for (const r of rows) {
    if (!r.ownerApproved || r.decision === "green" || !isOwnerRule(r.matched_rule_id)) continue;
    if (r.complaint_status !== "no" || r.welfare_status !== "no") continue;
    const list = groups.get(r.matched_rule_id) ?? [];
    list.push(r);
    groups.set(r.matched_rule_id, list);
  }
  const out: SuggestionProposal[] = [];
  for (const [ruleId, cases] of groups) {
    if (cases.length < 2) continue;
    const category = cases[0].request_type as PolicyCategory;
    const def = active[category];
    const config = CATEGORY_CONFIG[category];
    if (!def || !config?.numeric) continue;
    const valueOf = (r: CoverageRequest) => (config.numeric!.fact === "amountCents" ? r.amount_cents : r.confirmed_facts?.extensionDays ?? null);
    const values = cases.map(valueOf).filter((v): v is number => v !== null);
    if (values.length < 2) continue;
    const maxApproved = Math.max(...values);
    const target = def.rules.findIndex((r) => r.id === ruleId);
    const greenIdx = def.rules.findIndex((r) => r.colour === "green" && r.range);
    if (target < 0 || greenIdx < 0) continue;
    const [gLo, gHi] = toInterval(def.rules[greenIdx].range);
    const [tLo, tHi] = toInterval(def.rules[target].range);
    // Only suggest when the approved cases sit just above the green band.
    if (tLo !== gHi + 1 || maxApproved > tHi || maxApproved <= gHi) continue;
    const draft: PolicyDefinition = structuredClone(def);
    draft.title = def.title.replace(/\s*\(suggested.*\)$/, "") + " (suggested change)";
    draft.rules[greenIdx].range = { min: gLo === 0 ? null : gLo, max: maxApproved, maxInclusive: true };
    draft.rules[target].range = { min: maxApproved + 1, max: Number.isFinite(tHi) ? tHi : null, maxInclusive: true };
    if (!validatePolicy(draft).ok) continue;
    const fmt = (v: number) => (config.numeric!.unit === "cents" ? formatAud(v) : formatNumeric(category, v));
    out.push({
      patternKey: `${category}:${ruleId}:${maxApproved}`,
      category,
      requestIds: cases.map((c) => c.id),
      summary: `The owner approved ${cases.length} requests under "${def.rules[target].label}" between ${fmt(Math.min(...values))} and ${fmt(maxApproved)}, none with a complaint or welfare concern. Consider making requests up to ${fmt(maxApproved)} green.`,
      definition: draft,
    });
  }
  return out;
}
