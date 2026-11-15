import { ACTION_RULES, type ProposalAction } from "@/lib/agent/permissions";
import { describeRequest, formatWaiting, priorityTier, shortId, tierReason, type BriefingRow } from "@/lib/agent/briefing-logic";
import type { AttentionBlock, AttentionItem, AttentionKey, Command } from "@/lib/assistant/logic";
import { WORKFLOW_LABELS, type WorkflowId } from "@/lib/assistant/shortcuts";
import { STATUS_LABELS, type Colour, type RequestStatus, type Role } from "@/lib/domain/types";
import { workflowFor } from "@/lib/workflow/next-step";

// Pure logic for "What Needs My Attention?". The server reads the records and the
// permissions; this decides the category, order and wording of each item, so it can be
// tested without a database. Counts are exact: every row the server read is counted, and
// only the list is shortened.

export const ATTENTION_ORDER: AttentionKey[] = ["failed", "approval", "workflows", "clarification", "outcomes"];

export const ATTENTION_LABELS: Record<AttentionKey, string> = {
  failed: "Failed Actions",
  approval: "Decisions Awaiting Approval",
  workflows: "Workflows Waiting or Blocked",
  clarification: "Requests Needing Clarification",
  outcomes: "Outcomes to Record",
};

/** The same labels for a count of one. */
const ATTENTION_ONE: Record<AttentionKey, string> = {
  failed: "Failed Action",
  approval: "Decision Awaiting Approval",
  workflows: "Workflow Waiting or Blocked",
  clarification: "Request Needing Clarification",
  outcomes: "Outcome to Record",
};

export const ATTENTION_LIMIT = 8;

export type AttentionRequest = BriefingRow & { missing: number; owner_review_started_at: string | null };

export type AttentionRun = {
  id: string;
  workflow: WorkflowId;
  status: "active" | "waiting";
  stage: string;
  summary: string;
  updated_at: string;
  /** The request the run is working on, if it has saved one. */
  request: { id: string; status: RequestStatus; missing: number } | null;
};

export type AttentionProposal = { id: string; action: ProposalAction; created_at: string; target: string | null };

export type AttentionFailure = {
  id: string;
  action: ProposalAction;
  created_at: string;
  error: string;
  targetId: string | null;
  /** The person looking prepared it, so they can open the preview. */
  mine: boolean;
  /** A workflow of theirs that this failure belongs to. */
  runId: string | null;
};

export type AttentionInput = {
  role: Role;
  now: Date;
  requests: AttentionRequest[];
  runs: AttentionRun[];
  pending: AttentionProposal[];
  failed: AttentionFailure[];
};

const COLOUR_RANK: Record<Colour, number> = { red: 0, amber: 1, green: 2 };

function cleanError(e: string): string {
  let t = e.replace(/^[a-z_]+:\s*/, "").trim();
  if (!t) return "The database refused the change.";
  if (t.length > 160) t = `${t.slice(0, 157)}...`;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

type Ranked = AttentionItem & { rank: number[] };

function requestItem(r: AttentionRequest, role: Role, now: Date): Ranked | null {
  const wf = workflowFor({ role, status: r.status, missing: r.missing, reviewStartedAt: r.owner_review_started_at, colour: r.decision, welfare: r.welfare_status === "yes" });
  const flag = tierReason(priorityTier(r));
  const waited = formatWaiting(r.updated_at, now);
  const base = {
    key: `request:${r.id}`,
    title: `${describeRequest(r)} ${shortId(r.id)}`,
    colour: r.decision,
    href: `/requests/${r.id}`,
    rank: [COLOUR_RANK[r.decision], priorityTier(r), new Date(r.updated_at).getTime()],
  };
  const meta = `${STATUS_LABELS[r.status]} · waiting ${waited}${flag ? ` · ${flag}` : ""}`;
  const review = (label: string): AttentionItem["action"] => ({ label, command: { type: "review", requestId: r.id } as Command });
  const followup: AttentionItem["action"] = { label: "Prepare Follow-up", command: { type: "followup", requestId: r.id } as Command };

  if (wf.queue === "review") {
    return { ...base, category: "approval", reason: r.status === "awaiting_owner" ? "Sent to you by the admin team. Your decision is needed before anything changes." : "The owner's rules say you decide this. You can decide here without sending it to yourself.", meta, action: review("Review and Decide") };
  }
  if (wf.queue === "send") {
    if (r.status === "more_info_requested") return { ...base, category: "clarification", reason: "The owner asked for more information before deciding.", meta, action: followup };
    return { ...base, category: "approval", reason: "The owner's rules say the owner must approve this. It hasn't been sent to the owner yet.", meta, action: review("Review and Send") };
  }
  if (wf.queue === "clarify") {
    return { ...base, category: "clarification", reason: wf.missingDetails ? `${wf.detail}, so no rule can be applied yet.` : "Facts are missing or conflicting, so no rule can be applied yet.", meta, action: followup };
  }
  if (wf.queue === "record") {
    return { ...base, category: "outcomes", reason: r.status === "ready" ? "Inside the owner's rules. Act on it, then record the outcome." : `${STATUS_LABELS[r.status]}. Act on the decision, then record the outcome.`, meta, action: review("Record Outcome") };
  }
  // "owner" (an admin waiting for the owner) and "done" are not the viewer's to act on.
  return null;
}

const STAGE_REASONS: Record<string, string> = {
  waiting_owner: "Waiting for the owner's decision. Nothing changes until they decide.",
  waiting_family: "Waiting for the family to choose or agree.",
  waiting_tutor: "Waiting for the tutor to agree to cover.",
  complete_details: "Blocked: the request is missing required details.",
  confirm: "A preview is waiting for your confirmation.",
  prepare_failed: "Blocked: the last step couldn't be prepared.",
};

function runItem(run: AttentionRun, role: Role, now: Date): Ranked {
  const req = run.request;
  let reason = STAGE_REASONS[run.stage] ?? "Paused part way. Continue where you left off.";
  let urgent = 1;
  if (req && (req.status === "approved" || req.status === "ready") && run.stage === "waiting_owner") {
    reason = req.status === "approved" ? "The owner approved this. Continue to apply the change." : "Ready to apply. Continue to make the change.";
    urgent = 0;
  } else if (req?.status === "declined") {
    reason = "The owner declined this. Continue to close the workflow.";
    urgent = 0;
  } else if (req && run.stage === "waiting_owner" && role === "owner" && req.status === "awaiting_owner") {
    reason = "Waiting for your decision. Continue to decide here.";
    urgent = 0;
  }
  return {
    key: `workflow:${run.id}`,
    category: "workflows",
    title: `${WORKFLOW_LABELS[run.workflow]}: ${run.summary || "just started"}`,
    reason,
    colour: null,
    meta: `${run.status === "waiting" ? "Waiting" : "In progress"} · updated ${formatWaiting(run.updated_at, now)} ago`,
    action: { label: "Continue", command: { type: "workflow", runId: run.id, op: "continue" } },
    href: req ? `/requests/${req.id}` : null,
    rank: [urgent, -new Date(run.updated_at).getTime()],
  };
}

export function buildAttention(input: AttentionInput): AttentionBlock {
  const { role, now } = input;
  const items: Ranked[] = [];
  const runRequests = new Set(input.runs.map((r) => r.request?.id).filter(Boolean));

  for (const f of input.failed) {
    const label = ACTION_RULES[f.action]?.label ?? f.action;
    const action: AttentionItem["action"] = f.runId
      ? { label: "Continue", command: { type: "workflow", runId: f.runId, op: "continue" } }
      : f.targetId
        ? { label: "Open Request", command: { type: "review", requestId: f.targetId } as Command }
        : f.mine
          ? { label: "View Details", command: { type: "proposal", proposalId: f.id } }
          : { label: "Open Activity", href: "/activity" };
    items.push({
      key: `failed:${f.id}`,
      category: "failed",
      title: `${label} didn't go through`,
      reason: `${cleanError(f.error)} Nothing was changed.`,
      colour: null,
      meta: `Failed ${formatWaiting(f.created_at, now)} ago${f.mine ? "" : " · prepared by the admin team"}`,
      action,
      href: f.targetId ? `/requests/${f.targetId}` : null,
      rank: [-new Date(f.created_at).getTime()],
    });
  }

  for (const p of input.pending) {
    const label = ACTION_RULES[p.action]?.label ?? p.action;
    items.push({
      key: `proposal:${p.id}`,
      category: "approval",
      title: `${label}${p.target ? ` for ${p.target}` : ""}`,
      reason: "You prepared this change and it's waiting for your confirmation. Nothing changes until you confirm.",
      colour: null,
      meta: `Prepared ${formatWaiting(p.created_at, now)} ago`,
      action: { label: "Open Preview", command: { type: "proposal", proposalId: p.id } },
      href: null,
      rank: [-1, new Date(p.created_at).getTime()],
    });
  }

  for (const run of input.runs) items.push(runItem(run, role, now));

  let waitingOnOwner = 0;
  for (const r of input.requests) {
    if (runRequests.has(r.id)) continue;
    const item = requestItem(r, role, now);
    if (item) items.push(item);
    else if (r.status === "awaiting_owner") waitingOnOwner++;
  }

  const byCategory = (k: AttentionKey) => items.filter((i) => i.category === k).sort((a, b) => {
    for (let n = 0; n < Math.max(a.rank.length, b.rank.length); n++) {
      const d = (a.rank[n] ?? 0) - (b.rank[n] ?? 0);
      if (d) return d;
    }
    return a.key.localeCompare(b.key);
  });
  const ordered = ATTENTION_ORDER.flatMap(byCategory);
  const counts = ATTENTION_ORDER.map((key) => ({ key, label: ATTENTION_LABELS[key], count: items.filter((i) => i.category === key).length }));
  const notes: string[] = [];
  if (waitingOnOwner) notes.push(`${waitingOnOwner} request${waitingOnOwner === 1 ? " is" : "s are"} with the owner. There's nothing for you to do on ${waitingOnOwner === 1 ? "it" : "them"} until the owner decides.`);
  if (ordered.length > ATTENTION_LIMIT) notes.push(`Showing the first ${ATTENTION_LIMIT} of ${ordered.length}. Open the Dashboard to see everything.`);
  notes.push("Order: failed actions, then decisions awaiting approval, then workflows, then clarifications, then outcomes to record. Red before amber before green within each.");

  return {
    kind: "attention",
    generatedAt: now.toISOString(),
    role,
    total: ordered.length,
    counts,
    items: ordered.slice(0, ATTENTION_LIMIT).map(({ rank: _rank, ...i }) => i),
    notes,
  };
}

/** The sentence above the list. */
export function attentionHeadline(block: AttentionBlock): string {
  if (block.total === 0) return "Nothing needs your attention right now. There are no decisions, clarifications, waiting workflows or failed actions.";
  const parts = block.counts.filter((c) => c.count > 0).map((c) => `${c.count} ${(c.count === 1 ? ATTENTION_ONE[c.key] : c.label).toLowerCase()}`);
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `${block.total} item${block.total === 1 ? " needs" : "s need"} your attention: ${joined}.`;
}
