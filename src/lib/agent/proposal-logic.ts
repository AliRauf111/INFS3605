import { canonicalJson, hashDecisionInput } from "@/lib/engine/hash";
import type { ProposalAction } from "./permissions";

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

const LABELS: Record<keyof Preconditions, string> = {
  status: "The request's status changed.",
  currentDecisionId: "The rule check was run again.",
  updatedAt: "The request was updated by someone else.",
  archivedAt: "The request was archived or restored.",
  hiddenAt: "The request was removed from the lists or put back.",
  draftUpdatedAt: "The saved draft was changed by someone else.",
  activePolicyId: "A different policy version is active now.",
  recordsHash: "The linked booking or payment records changed.",
  decision: "The rule engine now gives a different result.",
};

/** List what differs between the preview's preconditions and the ones read now. */
export function diffPreconditions(before: Preconditions, now: Preconditions): string[] {
  const out: string[] = [];
  for (const key of Object.keys(LABELS) as Array<keyof Preconditions>) {
    if (!(key in before)) continue;
    const a = before[key] ?? null;
    const b = now[key] ?? null;
    const same = key === "updatedAt" || key === "draftUpdatedAt"
      ? (a === null ? null : new Date(a as string).getTime()) === (b === null ? null : new Date(b as string).getTime())
      : key === "archivedAt" || key === "hiddenAt"
        ? (a === null) === (b === null)
        : canonicalJson(a) === canonicalJson(b);
    if (!same) out.push(LABELS[key]);
  }
  return out;
}

/** What the database's execute function reports as changed, in words. */
export function describeDbChanges(changed: string[]): string[] {
  const map: Record<string, string> = {
    status: LABELS.status,
    decision: LABELS.currentDecisionId,
    updated: LABELS.updatedAt,
    archived: LABELS.archivedAt,
    removed: LABELS.hiddenAt,
    draft: LABELS.draftUpdatedAt,
  };
  return changed.map((c) => map[c] ?? `The ${c} changed.`);
}

export function expiryFrom(now: Date): string {
  return new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000).toISOString();
}

/** The confirmed result in words that keep a saved record apart from a real-world action. */
export function resultMessage(action: ProposalAction, opts: { requestType?: string; status?: string }): string {
  switch (action) {
    case "request.create":
      return `Request saved in Tutor Compass${opts.status ? ` with status ${opts.status}` : ""}. Nothing has been refunded, booked or sent.`;
    case "request.send_to_owner":
      return "Sent to the owner. The request is now Waiting for Owner. Nothing was sent to the family.";
    case "request.approve":
      return opts.requestType === "refund"
        ? "Owner decision recorded: Approved by Owner. No money has been transferred. The admin team still needs to process the refund and record the outcome."
        : "Owner decision recorded: Approved by Owner. Nothing has been changed outside Tutor Compass yet. The admin team still needs to act and record the outcome.";
    case "request.decline":
      return "Owner decision recorded: Declined by Owner. The admin team still needs to tell the family and record the outcome.";
    case "request.request_info":
      return "Owner decision recorded: Ask for Information. The request is back with the admin team.";
    case "request.record_outcome":
      return "Outcome recorded and the request is closed. This records what staff did; Tutor Compass did not carry out the action.";
    case "draft.save":
      return "Draft saved on the request. It has not been sent to anyone.";
  }
}
