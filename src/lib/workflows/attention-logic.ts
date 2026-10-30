import { PROPOSAL_ACTIONS, actionLabel, type ProposalAction } from "@/lib/agent/permissions";
import { tr } from "@/lib/i18n/reply";
import { describeRequest, formatWaiting, priorityTier, shortId, tierReason, type BriefingRow } from "@/lib/agent/briefing-logic";
import type { AttentionBlock, AttentionItem, AttentionKey, Command } from "@/lib/assistant/logic";
import type { WorkflowId } from "@/lib/assistant/shortcuts";
import { type Colour, type RequestStatus, type Role } from "@/lib/domain/types";
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

/** A category's name for a count, in the reader's language. ATTENTION_LABELS keeps the English. */
const attentionLabel = (key: AttentionKey, count: number) => tr(`reply.att.label.${key}`, { count });
const statusLabel = (s: RequestStatus) => tr(`domain.status.${s}`);
const labelOf = (a: ProposalAction) => ((PROPOSAL_ACTIONS as readonly string[]).includes(a) ? actionLabel(a) : a);

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
  if (!t) return tr("reply.wf.dbRefused");
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
  const meta = `${statusLabel(r.status)} · ${tr("reply.att.waiting", { time: waited })}${flag ? ` · ${flag}` : ""}`;
  const review = (label: string): AttentionItem["action"] => ({ label, command: { type: "review", requestId: r.id } as Command });
  const followup: AttentionItem["action"] = { label: tr("reply.brief.next.followup"), command: { type: "followup", requestId: r.id } as Command };

  if (wf.queue === "review") {
    return { ...base, category: "approval", reason: tr(r.status === "awaiting_owner" ? "reply.att.reason.sentToYou" : "reply.att.reason.youDecide"), meta, action: review(tr("reply.att.reviewDecide")) };
  }
  if (wf.queue === "send") {
    if (r.status === "more_info_requested") return { ...base, category: "clarification", reason: tr("reply.brief.why.moreInfo"), meta, action: followup };
    return { ...base, category: "approval", reason: tr("reply.att.reason.notSent"), meta, action: review(tr("reply.att.reviewSend")) };
  }
  if (wf.queue === "clarify") {
    return { ...base, category: "clarification", reason: wf.missingDetails ? tr("reply.att.reason.missingDetail", { detail: wf.detail }) : tr("reply.brief.why.clarify"), meta, action: followup };
  }
  if (wf.queue === "record") {
    return { ...base, category: "outcomes", reason: r.status === "ready" ? tr("reply.att.reason.ready") : tr("reply.att.reason.decided", { status: statusLabel(r.status) }), meta, action: review(tr("reply.brief.next.outcome")) };
  }
  // "owner" (an admin waiting for the owner) and "done" are not the viewer's to act on.
  return null;
}

const STAGES = ["waiting_owner", "waiting_family", "waiting_tutor", "complete_details", "confirm", "prepare_failed"] as const;
const stageReason = (stage: string) =>
  tr((STAGES as readonly string[]).includes(stage) ? `reply.att.stage.${stage as (typeof STAGES)[number]}` : "reply.att.stage.paused");

function runItem(run: AttentionRun, role: Role, now: Date): Ranked {
  const req = run.request;
  let reason = stageReason(run.stage);
  let urgent = 1;
  if (req && (req.status === "approved" || req.status === "ready") && run.stage === "waiting_owner") {
    reason = tr(req.status === "approved" ? "reply.att.run.approved" : "reply.att.run.ready");
    urgent = 0;
  } else if (req?.status === "declined") {
    reason = tr("reply.att.run.declined");
    urgent = 0;
  } else if (req && run.stage === "waiting_owner" && role === "owner" && req.status === "awaiting_owner") {
    reason = tr("reply.att.run.yourDecision");
    urgent = 0;
  }
  return {
    key: `workflow:${run.id}`,
    category: "workflows",
    title: `${tr(`reply.workflow.${run.workflow}`)}: ${run.summary || tr("reply.att.justStarted")}`,
    reason,
    colour: null,
    meta: `${tr(run.status === "waiting" ? "reply.att.waitingWord" : "reply.att.inProgress")} · ${tr("reply.att.updatedAgo", { time: formatWaiting(run.updated_at, now) })}`,
    action: { label: tr("reply.common.continue"), command: { type: "workflow", runId: run.id, op: "continue" } },
    href: req ? `/requests/${req.id}` : null,
    rank: [urgent, -new Date(run.updated_at).getTime()],
  };
}

export function buildAttention(input: AttentionInput): AttentionBlock {
  const { role, now } = input;
  const items: Ranked[] = [];
  const runRequests = new Set(input.runs.map((r) => r.request?.id).filter(Boolean));

  for (const f of input.failed) {
    const label = labelOf(f.action);
    const action: AttentionItem["action"] = f.runId
      ? { label: tr("reply.common.continue"), command: { type: "workflow", runId: f.runId, op: "continue" } }
      : f.targetId
        ? { label: tr("reply.common.openRequest"), command: { type: "review", requestId: f.targetId } as Command }
        : f.mine
          ? { label: tr("reply.att.viewDetails"), command: { type: "proposal", proposalId: f.id } }
          : { label: tr("reply.att.openActivity"), href: "/activity" };
    items.push({
      key: `failed:${f.id}`,
      category: "failed",
      title: tr("reply.att.failedTitle", { action: label }),
      reason: `${cleanError(f.error)} ${tr("reply.common.nothingChanged")}`,
      colour: null,
      meta: `${tr("reply.att.failedAgo", { time: formatWaiting(f.created_at, now) })}${f.mine ? "" : ` · ${tr("reply.att.byAdmin")}`}`,
      action,
      href: f.targetId ? `/requests/${f.targetId}` : null,
      rank: [-new Date(f.created_at).getTime()],
    });
  }

  for (const p of input.pending) {
    const label = labelOf(p.action);
    items.push({
      key: `proposal:${p.id}`,
      category: "approval",
      title: p.target ? tr("reply.att.forTarget", { action: label, target: p.target }) : label,
      reason: tr("reply.att.reason.prepared"),
      colour: null,
      meta: tr("reply.att.preparedAgo", { time: formatWaiting(p.created_at, now) }),
      action: { label: tr("reply.att.openPreview"), command: { type: "proposal", proposalId: p.id } },
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
  const counts = ATTENTION_ORDER.map((key) => ({ key, label: attentionLabel(key, 2), count: items.filter((i) => i.category === key).length }));
  const notes: string[] = [];
  if (waitingOnOwner) notes.push(tr("reply.att.withOwner", { count: waitingOnOwner }));
  if (ordered.length > ATTENTION_LIMIT) notes.push(tr("reply.att.showingFirst", { limit: ATTENTION_LIMIT, total: ordered.length }));
  notes.push(tr("reply.att.order"));

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
  if (block.total === 0) return tr("reply.att.nothing");
  const parts = block.counts.filter((c) => c.count > 0).map((c) => tr("reply.att.part", { count: c.count, label: attentionLabel(c.key, c.count).toLowerCase() }));
  const joined = parts.length > 1 ? tr("reply.att.join", { list: parts.slice(0, -1).join(", "), last: parts.at(-1) }) : parts[0];
  return tr("reply.att.headline", { count: block.total, list: joined });
}
