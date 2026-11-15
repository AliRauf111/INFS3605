import { canonicalJson, hashDecisionInput } from "@/lib/engine/hash";
import type { ProposalAction } from "./permissions";
import { tr } from "@/lib/i18n/reply";

// Pure parts of the approval process: what a proposal records, how two sets of
// preconditions are compared and how results are worded. The server and the database
// both enforce the process; this file only keeps the rules in one testable place.

export const PROPOSAL_TTL_MINUTES = 15;

export type ProposalStatus = "pending" | "succeeded" | "failed" | "expired" | "cancelled" | "superseded" | "stale";

export type Change = { field: string; current: string; proposed: string };

/** Everything a proposal's execution depends on. Any difference at confirm time makes it stale. */
export type Preconditions = {
  status?: string | null;
  currentDecisionId?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  hiddenAt?: string | null;
  draftUpdatedAt?: string | null;
  activePolicyId?: string | null;
  /** Fingerprint of the linked booking and payment records as they were at preview. */
  recordsHash?: string | null;
  /** For a workflow action: the lesson, slot, invoice or absence records as they were at preview. */
  workflow?: Record<string, string | number | null> | null;
  /** For a new request: the engine outcome the person saw. */
  decision?: { colour: string; matchedRuleId: string; policyVersionId: string | null; suggestedStatus: string; gaps: string[] } | null;
};

/** What the person sees, and exactly what they confirm. Stored with the proposal. */
export type ProposalPreview = {
  title: string;
  target: { reference: string; shortId: string | null; href: string | null; typeLabel: string; statusLabel: string | null };
  changes: Change[];
  note: string | null;
  body: string | null;
  editable: { field: "note" | "body"; label: string } | null;
  requiredRoleText: string;
  outcome: string;
  warnings: string[];
  policyRefs: string[];
  versions: string[];
};

export type ProposalView = {
  id: string;
  action: ProposalAction;
  status: ProposalStatus;
  preview: ProposalPreview;
  requiredRole: "staff" | "owner";
  canConfirm: boolean;
  expiresAt: string;
  replaces: string | null;
};

export function inputHash(action: ProposalAction, targetId: string | null, inputs: unknown): string {
  return hashDecisionInput({ action, targetId, inputs });
}

const LABEL_KEYS = ["status", "currentDecisionId", "updatedAt", "archivedAt", "hiddenAt", "draftUpdatedAt", "activePolicyId", "recordsHash", "decision", "workflow"] as const satisfies ReadonlyArray<keyof Preconditions>;
const label = (key: keyof Preconditions) => tr(`reply.changed.${key}`);

/** List what differs between the preview's preconditions and the ones read now. */
export function diffPreconditions(before: Preconditions, now: Preconditions): string[] {
  const out: string[] = [];
  for (const key of LABEL_KEYS) {
    if (!(key in before)) continue;
    const a = before[key] ?? null;
    const b = now[key] ?? null;
    const same = key === "updatedAt" || key === "draftUpdatedAt"
      ? (a === null ? null : new Date(a as string).getTime()) === (b === null ? null : new Date(b as string).getTime())
      : key === "archivedAt" || key === "hiddenAt"
        ? (a === null) === (b === null)
        : canonicalJson(a) === canonicalJson(b);
    if (!same) out.push(label(key));
  }
  return out;
}

/** What the database's execute function reports as changed, in words. */
export function describeDbChanges(changed: string[]): string[] {
  const map: Record<string, string> = {
    status: label("status"),
    decision: label("currentDecisionId"),
    updated: label("updatedAt"),
    archived: label("archivedAt"),
    removed: label("hiddenAt"),
    draft: label("draftUpdatedAt"),
    lesson: tr("reply.changed.db.lesson"),
    slot: tr("reply.changed.db.slot"),
    invoice: tr("reply.changed.db.invoice"),
    absence: tr("reply.changed.db.absence"),
  };
  return changed.map((c) => map[c] ?? tr("reply.changed.db.other", { thing: c }));
}

export function expiryFrom(now: Date): string {
  return new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000).toISOString();
}

/** The confirmed result in words that keep a saved record apart from a real-world action. */
export function resultMessage(action: ProposalAction, opts: { requestType?: string; status?: string }): string {
  if (action === "request.create") return tr(opts.status ? "reply.result.request_create_status" : "reply.result.request_create", { status: opts.status });
  if (action === "request.approve") return tr(opts.requestType === "refund" ? "reply.result.request_approve_refund" : "reply.result.request_approve");
  return tr(`reply.result.${action.replace(".", "_") as "draft_save"}`);
}
