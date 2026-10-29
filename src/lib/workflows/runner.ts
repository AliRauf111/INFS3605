import "server-only";
import { ApiError } from "@/lib/api/handler";
import { logActivity } from "@/lib/agent/activity";
import { ACTION_RULES, type ProposalAction } from "@/lib/agent/permissions";
import { cancelProposal, prepareProposal, proposalView, WORKFLOW_SETUP_MESSAGE } from "@/lib/agent/proposals";
import { approvedProcedures } from "@/lib/agent/reads";
import { SENSITIVE_NOTE, screenSensitive } from "@/lib/agent/sensitive";
import { numberWordsToDigits } from "@/lib/agent/intents";
import type { TurnCtx } from "@/lib/assistant/owner";
import { matchStudents, type Block, type Command, type Mood } from "@/lib/assistant/logic";
import { OPENING_QUESTIONS, WORKFLOW_LABELS, type WorkflowId } from "@/lib/assistant/shortcuts";
import { getActivePolicy, resolveBooking } from "@/lib/context/retrieve";
import { formatAud } from "@/lib/domain/money";
import { STATUS_LABELS, type TriState } from "@/lib/domain/types";
import { CATEGORY_CONFIG, describeRange, policyVersionLabel, type PolicySnapshot } from "@/lib/engine/policy";
import type { FactsForm } from "@/lib/validation/facts";
import { REMINDER_LABELS, daysBetween, formatDay, formatRange, formatSlot, hoursUntil, parseExtension, parseRange, reminderSchedule, sydneyToday } from "./dates";
import {
  APPLY_ACTION,
  NOTICE_HOURS,
  RunStateSchema,
  absenceNeed,
  absorbMessage,
  applyPick,
  coverCandidates,
  currentItem,
  emptyData,
  isAbsent,
  lessonNeed,
  needsAgreement,
  parseTriWord,
  paymentNeed,
  pickAlternatives,
  pipelineNeed,
  revisedDueDate,
  type AbsenceData,
  type ActiveRun,
  type LessonData,
  type PaymentData,
  type Pipeline,
  type RunState,
  type WorkflowData,
  withChoices,
} from "./logic";
import {
  WorkflowsNotSetUp,
  absences,
  allTutors,
  createRun,
  familiesByStudent,
  familyBusy,
  followProposal,
  freeSlots,
  invoiceById,
  invoicesFor,
  lessonById,
  loadRun,
  requestState,
  saveRun,
  scheduledReminders,
  slotById,
  tutorLessons,
  upcomingLessons,
  type LessonRow,
} from "./records";

// Runs the Lesson Change, Payment Extension and Tutor Absence workflows. Each turn it
// reads the records, asks only for what is still missing, and moves every change through
// the shared approval process: save the request so the owner's rules decide who must
// approve, get that approval, then apply the change and read it back. The AI is not used
// here: every figure, option and decision comes from the records and the rules.

export type WorkflowInput = { start?: WorkflowId; runId?: string; text?: string; op?: "continue" | "pick" | "decide" | "cancel"; value?: string };

type Out = { awaiting: string | null; status: "active" | "waiting" | "completed"; stage: string; mood: Mood };

const say = (ctx: TurnCtx, text: string) => ctx.blocks.push({ kind: "text", text });
const notice = (ctx: TurnCtx, tone: "info" | "warning" | "error", text: string) => ctx.blocks.push({ kind: "notice", tone, text });
const ask = (awaiting: string, stage = awaiting): Out => ({ awaiting, status: "active", stage, mood: "clarify" });
const waiting = (stage: string, awaiting: string | null = null): Out => ({ awaiting, status: "waiting", stage, mood: "neutral" });
const confirmOut = (): Out => ({ awaiting: "confirm", status: "active", stage: "confirm", mood: "neutral" });

const TRI_OPTIONS = (field: string) => [
  { label: "Yes", value: `${field}:yes` },
  { label: "No", value: `${field}:no` },
  { label: "Not Sure", value: `${field}:unsure` },
];

function options(ctx: TurnCtx, runId: string, label: string, list: Array<{ label: string; value: string }>, op: "pick" | "decide" = "pick") {
  ctx.blocks.push({ kind: "options", label, options: withChoices(runId, list.map((o) => ({ label: o.label, command: { type: "workflow", runId, op, value: o.value } as Command }))) });
}

const continueCommand = (runId: string): Command => ({ type: "workflow", runId, op: "continue" });

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function triText(v: TriState | null): string {
  return v === "yes" ? "Yes" : v === "no" ? "No" : v === "unsure" ? "Not sure" : "Not answered";
}

const COMPLAINT_Q = "Is the family making a complaint about the service or a tutor?";
const WELFARE_Q = "Is there any concern about a child's safety or wellbeing? If you're unsure, say so. It won't be treated as no.";

// ---------------------------------------------------------------------------
// Entry point

export async function runWorkflow(ctx: TurnCtx, input: WorkflowInput, active: ActiveRun | null): Promise<{ mood: Mood; run: ActiveRun | null }> {
  ctx.modeNote = ctx.live
    ? "Workflow steps use current records and the owner's rules. No AI was used for this reply."
    : "Workflow steps use current records and the owner's rules. Demo mode: no live AI.";
  try {
    return await runInner(ctx, input, active);
  } catch (e) {
    if (e instanceof WorkflowsNotSetUp) {
      notice(ctx, "error", WORKFLOW_SETUP_MESSAGE);
      return { mood: "error", run: null };
    }
    if (e instanceof ApiError && e.status === 503) {
      notice(ctx, "error", e.message);
      return { mood: "error", run: active };
    }
    console.error("[compass] workflow failed:", e instanceof Error ? e.message : e);
    notice(ctx, "error", "Something went wrong reading the records, so I stopped. Nothing was changed. Try again shortly.");
    return { mood: "error", run: active };
  }
}

async function runInner(ctx: TurnCtx, input: WorkflowInput, active: ActiveRun | null): Promise<{ mood: Mood; run: ActiveRun | null }> {
  if (input.start) {
    const state: RunState = { data: emptyData(input.start), awaiting: "start" };
    const row = await createRun(ctx.user.id, ctx.sessionKey, input.start, state);
    await logActivity({ sessionKey: ctx.sessionKey, actorId: ctx.user.id, mode: "system", eventType: "workflow_started", state: "pending", summary: `${ctx.user.displayName} started a ${WORKFLOW_LABELS[input.start]} workflow in Compass.`, detail: { runId: row.id } });
    // A request typed in the chat starts the workflow and is read straight away.
    if (input.text) {
      ctx.steps.push({ label: `Starting the ${WORKFLOW_LABELS[input.start]} workflow`, state: "done" });
      return runInner(ctx, { runId: row.id, text: input.text }, { id: row.id, workflow: input.start });
    }
    say(ctx, OPENING_QUESTIONS[input.start]);
    ctx.blocks.push({ kind: "options", label: "Or", options: withChoices(row.id, [{ label: "What Needs My Attention?", command: { type: "attention" } }], input.start) });
    return { mood: "clarify", run: { id: row.id, workflow: input.start } };
  }

  const runId = input.runId ?? active?.id;
  const row = runId ? await loadRun(runId, ctx.user.id) : null;
  if (!row) {
    notice(ctx, "warning", "I couldn't find that workflow. It may belong to someone else or have been removed. Nothing was changed.");
    return { mood: "clarify", run: null };
  }
  const run: ActiveRun = { id: row.id, workflow: row.workflow };
  const parsed = RunStateSchema.safeParse(row.state);
  if (!parsed.success) {
    notice(ctx, "error", "This workflow's saved progress couldn't be read, so I stopped. Nothing was changed. Start it again from the welcome screen.");
    return { mood: "error", run: null };
  }
  if (row.status === "completed" || row.status === "cancelled") {
    say(ctx, `This ${WORKFLOW_LABELS[row.workflow]} is already ${row.status === "completed" ? "finished" : "cancelled"}.${row.summary ? ` ${row.summary}.` : ""}`);
    return { mood: "neutral", run: null };
  }
  let { data } = parsed.data;
  const { awaiting } = parsed.data;
  const today = sydneyToday(new Date());
  const before = JSON.stringify(data);
  let decision: string | undefined;
  let later: "family" | "tutor" | null = null;

  if (input.op === "cancel") {
    for (const id of pendingIds(data)) await cancelProposal(ctx.user, id).catch(() => null);
    await saveRun(row.id, { status: "cancelled", stage: "cancelled" });
    say(ctx, `Stopped the ${WORKFLOW_LABELS[row.workflow]}. Nothing more will change.${anyApplied(data) ? " Changes you already confirmed stay as they are." : " Nothing was changed."}`);
    return { mood: "neutral", run: null };
  }
  if (input.op === "pick" && input.value) {
    const next = applyPick(data, input.value);
    if (!next) notice(ctx, "warning", "That option isn't available any more. Here's where things are now.");
    else {
      data = next;
      if (/^(family|tutorok):later$/.test(input.value)) later = input.value.startsWith("family") ? "family" : "tutor";
      if (input.value === "slot:waiting") later = "family";
    }
  }
  if (input.op === "decide" && input.value) decision = input.value;
  if (input.text) {
    const text = input.text;
    const flagged = ctx.blocks.some((b) => b.kind === "notice" && b.text.startsWith(SENSITIVE_NOTE));
    if (screenSensitive(text).sensitive && !flagged) {
      notice(ctx, "warning", `${SENSITIVE_NOTE} If a child may be at risk, tell the owner straight away, as KB-01 says.`);
      await logActivity({ sessionKey: ctx.sessionKey, actorId: ctx.user.id, mode: "system", eventType: "sensitive_case_routed", state: "completed", summary: "A Compass workflow message may describe a welfare concern. It stayed on our server." });
    }
    if (/^\s*(cancel|stop|never ?mind|start again)\s*[.!]?\s*$/i.test(text)) return runInner(ctx, { op: "cancel", runId: row.id }, active);
    data = applyText(data, awaiting, text, today);
    if (JSON.stringify(data) === before && awaiting && awaiting !== "start") notice(ctx, "info", "I didn't catch that. Use the options below, or type your answer.");
    if (JSON.stringify(data) === before && awaiting === "slot" && /\b(not yet|hasn'?t|haven'?t|no reply|waiting)\b/i.test(text)) {
      data = { ...(data as LessonData), parentChoice: "waiting" };
      later = "family";
    }
  }

  let out: Out;
  const env: Env = { ctx, runId: row.id, decision, later, repeat: input.op === "continue" || Boolean(input.text), today };
  if (data.kind === "lesson_change") out = await lessonStep(env, data);
  else if (data.kind === "payment_extension") out = await paymentStep(env, data);
  else out = await absenceStep(env, data);

  await saveRun(row.id, {
    state: { data, awaiting: out.awaiting } satisfies RunState,
    status: out.status,
    stage: out.stage.slice(0, 60),
    summary: summaryOf(data).slice(0, 300),
    request_id: currentRequest(data),
  });
  if (out.status === "completed") {
    await logActivity({ sessionKey: ctx.sessionKey, requestId: currentRequest(data), actorId: ctx.user.id, mode: "system", eventType: "workflow_completed", state: "completed", summary: `${WORKFLOW_LABELS[row.workflow]} finished: ${summaryOf(data)}.`.slice(0, 500), detail: { runId: row.id } });
  }
  return { mood: out.mood, run: out.status === "completed" ? null : run };
}

type Env = { ctx: TurnCtx; runId: string; decision?: string; later: "family" | "tutor" | null; repeat: boolean; today: string };

function pipelines(d: WorkflowData): Pipeline[] {
  return d.kind === "tutor_absence" ? d.items.map((i) => i.pipeline) : [d.pipeline];
}

function pendingIds(d: WorkflowData): string[] {
  const ids = pipelines(d).map((p) => p.pendingProposalId).filter((x): x is string => Boolean(x));
  if (d.kind === "tutor_absence" && d.absenceProposalId) ids.push(d.absenceProposalId);
  return ids;
}

const anyApplied = (d: WorkflowData) => pipelines(d).some((p) => p.applied) || (d.kind === "tutor_absence" && Boolean(d.absenceId));

function currentRequest(d: WorkflowData): string | null {
  if (d.kind !== "tutor_absence") return d.pipeline.requestId;
  const i = currentItem(d);
  return (i >= 0 ? d.items[i].pipeline.requestId : d.items.at(-1)?.pipeline.requestId) ?? null;
}

function summaryOf(d: WorkflowData): string {
  if (d.kind === "lesson_change") return [d.bookingId || d.reference, d.lessonId].filter(Boolean).join(" · ") || "Lesson not chosen yet";
  if (d.kind === "payment_extension") return [d.paymentId || d.reference, d.extensionDays ? `${d.extensionDays} extra days` : ""].filter(Boolean).join(" · ") || "Invoice not chosen yet";
  return [d.tutorId ? `${d.tutorHint || d.tutorId} (${d.tutorId})` : "", d.startsOn ? formatRange(d.startsOn, d.endsOn) : "", d.lessonsChecked ? `${d.items.length} lesson${d.items.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "Tutor not chosen yet";
}

/** A typed reply, read against the question Compass asked last. */
export function applyText(d: WorkflowData, awaiting: string | null, raw: string, today: string): WorkflowData {
  const text = numberWordsToDigits(raw);
  const tri = parseTriWord(text);
  if (awaiting === "complaint" || awaiting === "welfare") return tri ? { ...d, [awaiting]: tri } : absorbMessage(d, text, today);
  if (awaiting === "fee" && d.kind === "lesson_change") return tri ? { ...d, financialImpact: tri } : d;
  if (d.kind === "payment_extension" && awaiting === "days") {
    const days = parseExtension(text, null, today);
    if (days && days >= 1 && days <= 120) return { ...d, extensionDays: days };
    return absorbMessage(d, text, today);
  }
  if (d.kind === "tutor_absence") {
    if (awaiting === "period") {
      const r = parseRange(text, today);
      return r ? { ...d, startsOn: r.start, endsOn: r.end } : d;
    }
    if (awaiting === "agreement" && tri === "yes") {
      const i = d.items.findIndex((x) => needsAgreement(x));
      const kind = i >= 0 ? needsAgreement(d.items[i]) : null;
      return kind ? applyPick(d, kind === "family" ? "family:yes" : "tutorok:yes") ?? d : d;
    }
    if (awaiting === "tutor" || awaiting === "start") return absorbMessage({ ...d, tutorId: "", tutorHint: "" }, text, today);
  }
  return absorbMessage(d, text, today);
}

// ---------------------------------------------------------------------------
// Shared pieces

const WHO: Record<string, string> = { green: "Admin can go ahead", amber: "Owner approves", red: "Owner decides" };

function policyLines(p: PolicySnapshot): string[] {
  return p.definition.rules.map((r) => {
    const when = CATEGORY_CONFIG[p.category].numeric ? describeRange(p.category, r.range) : r.financialImpact === "yes" ? "Fees affected" : r.financialImpact === "no" ? "No fee change" : "Any";
    return `${r.label} (${when}): ${r.colour === "green" ? "Green" : r.colour === "amber" ? "Yellow" : "Red"}, ${WHO[r.colour].toLowerCase()}.`;
  });
}

function simulated(ctx: TurnCtx, title: string, to: string, body: string) {
  ctx.blocks.push({ kind: "simulated", title, to, body, note: "Simulated message. Tutor Compass hasn't sent it: email and text aren't connected. Copy it if you want to use it." });
}

async function prepareAndShow(env: Env, p: Pipeline, body: Record<string, unknown>, intro: string): Promise<Out> {
  const { ctx } = env;
  try {
    const proposal = await prepareProposal(ctx.user, { sessionKey: ctx.sessionKey, ...body });
    p.pendingProposalId = proposal.id;
    p.pendingAction = proposal.action;
    p.failure = null;
    ctx.blocks.push({ kind: "proposal", proposal, intro, next: { label: "Continue", command: continueCommand(env.runId) } });
    return confirmOut();
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) throw e;
    const msg = e instanceof ApiError ? e.message : "I couldn't prepare that. Nothing was changed.";
    notice(ctx, "error", msg);
    p.failure = msg.slice(0, 400);
    say(ctx, "Nothing was changed. Fix the records and press Continue to try again, or stop this workflow.");
    ctx.blocks.push({ kind: "options", label: "Next", options: [
      { label: "Continue", command: continueCommand(env.runId) },
      { label: "Stop Workflow", command: { type: "workflow", runId: env.runId, op: "cancel" } },
    ] });
    return { awaiting: null, status: "active", stage: "prepare_failed", mood: "error" };
  }
}

type PipelineSpec = {
  workflow: WorkflowId;
  /** One line describing the change, used in notes to the owner. */
  summary: string;
  form: FactsForm;
  applyInputs: Record<string, unknown>;
  /** Shown just before the request is saved: the prepared change. */
  beforeSave?: () => void;
  /** Read the records back after the change and show what they say now. */
  verify: (result: Record<string, unknown> | null) => Promise<string>;
};

const DECISIONS: Record<string, { action: ProposalAction; note: (s: string) => string }> = {
  approve: { action: "request.approve", note: (s) => `Approved in Compass: ${s}. The change can now be applied.` },
  decline: { action: "request.decline", note: (s) => `Declined in Compass: ${s}. Nothing is to change.` },
  request_info: { action: "request.request_info", note: (s) => `Before I decide, please check with the family and the tutor: ${s}.` },
};

/**
 * The approval-and-apply steps every workflow shares. The request's status and the shared
 * next-step rules decide the step: save, owner decision, send to owner, wait, or apply.
 */
async function pipeline(env: Env, p: Pipeline, spec: PipelineSpec): Promise<Out> {
  const { ctx } = env;
  const apply = APPLY_ACTION[spec.workflow];
  let appliedResult: Record<string, unknown> | null = null;

  if (p.pendingProposalId) {
    const o = await followProposal(p.pendingProposalId, ctx.user.id);
    if (o?.status === "pending") {
      say(ctx, "The preview is still waiting for your confirmation. Confirm it to go on, or Cancel it to stop.");
      try {
        const proposal = await proposalView(ctx.user, o.id);
        ctx.blocks.push({ kind: "proposal", proposal, intro: null, next: { label: "Continue", command: continueCommand(env.runId) } });
      } catch {
        /* shown already above */
      }
      return confirmOut();
    }
    p.pendingProposalId = null;
    p.pendingAction = null;
    if (o?.status === "succeeded") {
      if (o.action === "request.create" && typeof o.result?.id === "string") {
        p.requestId = o.result.id;
        ctx.steps.push({ label: "Request saved with the owner's rule result", state: "done" });
      } else if (o.action === apply) {
        p.applied = true;
        appliedResult = o.result;
      } else {
        ctx.steps.push({ label: `${ACTION_RULES[o.action].label} recorded`, state: "done" });
      }
    } else if (o?.status === "failed") {
      const why = String(o.result?.error ?? "The database refused the change.").replace(/^[a-z_]+:\s*/, "");
      p.failure = why.slice(0, 400);
      notice(ctx, "error", `That didn't go through: ${why}. Nothing was changed.`);
    } else if (o) {
      notice(ctx, "info", `The last preview was ${o.status === "stale" ? "out of date" : o.status}, so nothing was changed. Here's where things are now.`);
    }
  }

  if (p.applied) {
    if (!p.verified) {
      say(ctx, "Done. I read the records back to check the change:");
      p.verified = (await spec.verify(appliedResult)).slice(0, 800);
      await logActivity({ sessionKey: ctx.sessionKey, requestId: p.requestId, actorId: ctx.user.id, mode: "system", eventType: "workflow_step", state: "completed", summary: `Compass read the records back after the change: ${p.verified}`.slice(0, 500) });
    }
    return { awaiting: null, status: "completed", stage: "done", mood: "success" };
  }

  const req = p.requestId ? await requestState(p.requestId) : null;
  const need = pipelineNeed(p, req, ctx.user.role);
  const reqLink = p.requestId ? { label: "Open Request", href: `/requests/${p.requestId}` } : null;
  switch (need) {
    case "save":
      spec.beforeSave?.();
      return prepareAndShow(env, p, { action: "request.create", facts: spec.form },
        "First, save the request. The owner's rules decide whether you can go ahead or the owner must approve. Nothing else changes yet.");
    case "apply":
      return prepareAndShow(env, p, { action: apply, requestId: p.requestId!, inputs: spec.applyInputs },
        req?.status === "approved" ? "The owner approved this. Here's exactly what will change." : "The owner's rules allow this. Here's exactly what will change.");
    case "owner_decision": {
      const d = env.decision ? DECISIONS[env.decision] : undefined;
      if (d) return prepareAndShow(env, p, { action: d.action, requestId: p.requestId!, note: d.note(spec.summary) }, "Here's the decision that will be recorded. You can edit the note first.");
      say(ctx, "The owner's rules say this needs the owner's approval. You're the owner, so you can decide here.");
      options(ctx, env.runId, "Your decision", [
        { label: "Approve", value: "approve" },
        { label: "Decline", value: "decline" },
        { label: "Ask for Information", value: "request_info" },
      ], "decide");
      if (reqLink) ctx.blocks.push({ kind: "found", items: [`Request: ${req?.reference} · ${STATUS_LABELS[req!.status]}`], links: [reqLink] });
      return ask("decision");
    }
    case "send_to_owner":
      return prepareAndShow(env, p, { action: "request.send_to_owner", requestId: p.requestId!, note: `Please review: ${spec.summary}.` },
        "The owner's rules say the owner must approve this. Send it to the owner. Nothing else changes.");
    case "waiting_owner":
      say(ctx, ctx.user.role === "owner"
        ? "This is waiting for an owner decision, but it isn't ready for one yet. Open the request to see why."
        : "This is with the owner now. Nothing changes until they decide. When they approve it, it shows under What Needs My Attention? with a Continue button.");
      if (reqLink) ctx.blocks.push({ kind: "found", items: [`Request: ${req?.reference} · ${req ? STATUS_LABELS[req.status] : ""}`], links: [reqLink] });
      return waiting("waiting_owner");
    case "complete_details":
      say(ctx, "Some required details are missing on the request, so it can't go to the owner or be approved yet. Complete them on the request, then come back and press Continue.");
      ctx.blocks.push({ kind: "found", items: [`Request: ${req?.reference}`], links: [{ label: "Complete Missing Details", href: `/requests/${p.requestId}?details=1` }] });
      ctx.blocks.push({ kind: "options", label: "Next", options: withChoices(env.runId, [{ label: "Continue", command: continueCommand(env.runId) }]) });
      return waiting("complete_details");
    case "declined":
      p.stopped = true;
      say(ctx, "The owner declined this, so nothing was changed. Let the family know, then record the outcome on the request.");
      if (reqLink) ctx.blocks.push({ kind: "found", items: [`Request: ${req?.reference} · Declined by Owner`], links: [reqLink] });
      return { awaiting: null, status: "completed", stage: "declined", mood: "neutral" };
    case "closed_elsewhere":
      p.stopped = true;
      say(ctx, "The request was closed outside this workflow, so I didn't change anything.");
      return { awaiting: null, status: "completed", stage: "closed_elsewhere", mood: "neutral" };
    case "confirm":
    case "done":
      return { awaiting: null, status: "completed", stage: "done", mood: "success" };
  }
}

function lessonLine(l: LessonRow): string {
  const b = l.bookings;
  return `${b?.families?.student_name ?? b?.id ?? l.booking_id}, ${b?.subject ?? "lesson"}, ${formatSlot(l.starts_at)} with ${l.tutors?.name ?? l.tutor_id}`;
}

async function readPolicy(ctx: TurnCtx, category: "lesson_change" | "payment_extension"): Promise<PolicySnapshot | null> {
  const policy = await getActivePolicy(category);
  ctx.steps.push({ label: policy ? `Reading the owner's policy (${policyVersionLabel(policy)})` : "Reading the owner's policy: none active", state: policy ? "done" : "blocked" });
  return policy;
}

// ---------------------------------------------------------------------------
// Lesson Change

async function lessonStep(env: Env, d: LessonData): Promise<Out> {
  const { ctx } = env;
  const now = new Date();
  const knewLesson = Boolean(d.lessonId);
  for (let guard = 0; guard < 10; guard++) {
    const need = lessonNeed(d);
    if (need === "reference") {
      if (!d.reference && d.studentHint) {
        const families = matchStudents(await familiesByStudent(), d.studentHint);
        ctx.steps.push({ label: `Looking for ${d.studentHint}'s booking`, state: families.length === 1 ? "done" : "blocked" });
        if (families.length === 1) {
          d.reference = families[0].id;
          continue;
        }
        say(ctx, families.length
          ? `More than one family has a student called ${d.studentHint}. What's the booking reference? For example BK-1042.`
          : `I couldn't find a student called ${d.studentHint}. What's the booking reference? For example BK-1042.`);
        d.studentHint = "";
        return ask("reference");
      }
      if (!d.reference) {
        say(ctx, "I couldn't find a booking reference in that. Which booking is it? For example BK-1042 or FAM-07.");
        return ask("reference");
      }
      let ref = d.reference;
      if (ref.startsWith("LSN-")) {
        const l = await lessonById(ref);
        if (l?.status === "scheduled" && new Date(l.starts_at) > now) {
          d.bookingId = l.booking_id;
          d.lessonId = l.id;
          continue;
        }
      }
      if (ref.startsWith("INV-")) ref = (await invoicesFor(ref))[0]?.booking_id ?? ref;
      const b = await resolveBooking(ref, null);
      if (b.status === "found") {
        d.bookingId = b.row.id;
        ctx.steps.push({ label: `Found booking ${b.row.id}: ${b.row.subject} for ${b.row.families?.student_name ?? "the student"} with ${b.row.tutors?.name ?? b.row.tutor_id}`, state: "done" });
        continue;
      }
      if (b.status === "multiple") {
        ctx.steps.push({ label: "Finding the booking", state: "blocked" });
        say(ctx, `${b.reference} has more than one booking. Which one is it?`);
        options(ctx, env.runId, "Choose a booking", b.candidates.map((c) => ({ label: c.label, value: `booking:${c.id}` })));
        return ask("booking");
      }
      ctx.steps.push({ label: "Finding the booking", state: "failed" });
      say(ctx, `I couldn't find a booking for ${d.reference}. Check the reference and try again, for example BK-1042.`);
      d.reference = "";
      return ask("reference");
    }
    if (need === "lesson") {
      const lessons = await upcomingLessons(d.bookingId, now);
      ctx.steps.push({ label: `Reading upcoming lessons on ${d.bookingId}`, state: lessons.length ? "done" : "blocked" });
      if (!lessons.length) {
        say(ctx, `${d.bookingId} has no upcoming lessons on the timetable, so there's nothing to move. Share another booking reference if you meant a different one.`);
        d.bookingId = "";
        d.reference = "";
        return ask("reference");
      }
      if (lessons.length === 1) {
        d.lessonId = lessons[0].id;
        continue;
      }
      say(ctx, "Which lesson needs to change?");
      options(ctx, env.runId, "Choose a lesson", lessons.slice(0, 8).map((l) => ({ label: `${formatSlot(l.starts_at)} with ${l.tutors?.name ?? l.tutor_id}`, value: `lesson:${l.id}` })));
      return ask("lesson");
    }

    const lesson = await lessonById(d.lessonId);
    if (!lesson || lesson.status !== "scheduled" || new Date(lesson.starts_at) <= now) {
      say(ctx, "That lesson is no longer scheduled, so there's nothing to move. Which lesson do you mean?");
      d.lessonId = "";
      d.slotId = "";
      continue;
    }
    if (!knewLesson && guard < 9) {
      await showLessonFound(ctx, d, lesson, now);
    }

    if (need === "complaint" || need === "welfare") {
      say(ctx, need === "complaint" ? COMPLAINT_Q : WELFARE_Q);
      options(ctx, env.runId, need === "complaint" ? "Complaint" : "Welfare concern", TRI_OPTIONS(need));
      return ask(need);
    }
    const tutorId = lesson.bookings?.tutor_id ?? lesson.tutor_id;
    if (need === "slot") {
      const [slots, busy, abs] = await Promise.all([freeSlots([tutorId], now), familyBusy(lesson.bookings?.family_id ?? "", lesson.id), absences([tutorId])]);
      const alts = pickAlternatives(slots, { now, lesson: { startsAt: lesson.starts_at, endsAt: lesson.ends_at }, busy, absences: abs, dayHint: d.dayHint, partHint: d.partHint });
      const tutorName = lesson.bookings?.tutor_id === lesson.tutor_id ? lesson.tutors?.name ?? tutorId : tutorId;
      ctx.steps.push({ label: `Checking ${tutorName}'s free times`, state: alts.length ? "done" : "blocked" });
      if (!alts.length) {
        say(ctx, `${tutorName} has no free times at least ${NOTICE_HOURS} hours away that fit. Ask the tutor for more times, then start a new Lesson Change. Nothing was changed.`);
        d.pipeline.stopped = true;
        return { awaiting: null, status: "completed", stage: "no_times", mood: "clarify" };
      }
      const student = lesson.bookings?.families?.student_name ?? "your child";
      if (d.parentChoice === "waiting" && env.later) {
        simulated(ctx, "Message offering new times", lesson.bookings?.families?.parent_name ?? "The family",
          `Hello,\n\nWe need to find a new time for ${student.split(" ")[0]}'s ${lesson.bookings?.subject ?? ""} lesson on ${formatSlot(lesson.starts_at)}. ${tutorName} is free at:\n${alts.map((s) => `- ${formatSlot(s.startsAt)}`).join("\n")}\n\nPlease let us know which suits. Nothing changes until you reply.\n\nKind regards`);
        say(ctx, "Here's a message offering these times. It hasn't been sent. When the family replies, come back and choose their time. This stays under What Needs My Attention? until then.");
        options(ctx, env.runId, "The family's choice", alts.map((s) => ({ label: formatSlot(s.startsAt), value: `slot:${s.id}` })));
        return waiting("waiting_family", "slot");
      }
      const wanted = d.dayHint !== null || d.partHint ? " The ones nearest to what the family asked for come first." : "";
      say(ctx, `${tutorName} is free at these times. Each is at least ${NOTICE_HOURS} hours away and the same length. None clashes with the family's other lessons.${wanted} Which time did the family choose?`);
      options(ctx, env.runId, "The family's choice", [
        ...alts.map((s) => ({ label: formatSlot(s.startsAt), value: `slot:${s.id}` })),
        { label: "Family Hasn't Chosen Yet", value: "slot:waiting" },
      ]);
      return ask("slot");
    }
    const slot = await slotById(d.slotId);
    // Once the move is prepared or done, the slot is ours: the database checks it again on confirm.
    const committed = d.pipeline.applied || d.pipeline.stopped || (d.pipeline.pendingAction === APPLY_ACTION.lesson_change && Boolean(d.pipeline.pendingProposalId));
    if (!slot || (slot.status !== "free" && !committed)) {
      notice(ctx, "warning", "That time is no longer free. Choose another time.");
      d.slotId = "";
      d.parentChoice = null;
      continue;
    }
    if (need === "financialImpact") {
      const sameLength = new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime() === new Date(lesson.ends_at).getTime() - new Date(lesson.starts_at).getTime();
      if (sameLength && slot.tutorId === tutorId) {
        d.financialImpact = "no";
        ctx.steps.push({ label: "Same length and tutor, so the fees don't change", state: "done" });
        continue;
      }
      say(ctx, "Does the change affect fees, for example a longer lesson or a cancellation fee?");
      options(ctx, env.runId, "Fees", TRI_OPTIONS("fee"));
      return ask("fee");
    }

    const student = lesson.bookings?.families?.student_name ?? "the student";
    const summary = `move ${student}'s lesson ${lesson.id} (${lesson.bookings?.subject ?? ""}) from ${formatSlot(lesson.starts_at)} to ${formatSlot(slot.startsAt)} with ${slot.tutorName}`;
    const out = await pipeline(env, d.pipeline, {
      workflow: "lesson_change",
      summary,
      form: {
        requestType: "lesson_change", referenceId: d.bookingId, bookingId: d.bookingId, proposedSlotId: d.slotId,
        financialImpact: d.financialImpact, complaint: d.complaint, welfare: d.welfare,
        context: d.context || `Lesson change in Compass: ${summary}.`,
      },
      applyInputs: { lessonId: lesson.id, newSlotId: slot.id, agreement: "The family chose this time, as recorded in Compass." },
      verify: (r) => verifyLesson(ctx, lesson.id, r, true),
    });
    return out;
  }
  return ask("reference");
}

async function showLessonFound(ctx: TurnCtx, d: LessonData, lesson: LessonRow, now: Date) {
  const [policy, procedures] = await Promise.all([readPolicy(ctx, "lesson_change"), approvedProcedures().catch(() => [])]);
  const kb = procedures.find((p) => p.category === "lesson_change");
  const hours = hoursUntil(lesson.starts_at, now);
  const items = [
    `Lesson: ${lessonLine(lesson)} (${lesson.id}).`,
    `Booking: ${lesson.booking_id}.`,
    ...(policy ? [`Policy: ${policy.definition.title} (${policyVersionLabel(policy)}).`, ...policyLines(policy)] : ["Policy: none active, so the owner must approve any change."]),
    ...(kb ? [`${kb.id} ${kb.title}: ${kb.body.split(/(?<=[.])\s/)[0]}`] : []),
    `From the message: complaint ${triText(d.complaint).toLowerCase()}, welfare concern ${triText(d.welfare).toLowerCase()}.`,
  ];
  ctx.blocks.push({ kind: "found", items, links: policy ? [{ label: "View Policy", href: `/rules/${policy.id}` }] : [], note: "Fictional demonstration data." });
  if (hours < NOTICE_HOURS) {
    notice(ctx, "warning", `This lesson starts in under ${NOTICE_HOURS} hours. ${kb?.id ?? "The rescheduling procedure"} asks for ${NOTICE_HOURS} hours' notice, so check with the owner before promising anything.`);
  }
}

async function verifyLesson(ctx: TurnCtx, lessonId: string, result: Record<string, unknown> | null, messageFamily: boolean): Promise<string> {
  const lesson = await lessonById(lessonId);
  const after = (result?.after ?? {}) as { slotId?: string; startsAt?: string };
  const before = (result?.before ?? {}) as { slotId?: string; tutorId?: string; startsAt?: string };
  const tutors = await allTutors();
  const name = (id?: string) => tutors.find((t) => t.id === id)?.name ?? id ?? "Unknown";
  const ok = Boolean(lesson && lesson.status === "scheduled" && (!after.slotId || lesson.slot_id === after.slotId));
  if (!lesson || !ok) {
    notice(ctx, "error", "The database said the change was made, but the lesson doesn't read back as expected. Check it on the timetable before telling anyone.");
    return "The lesson did not read back as expected.";
  }
  ctx.blocks.push({
    kind: "result",
    title: "Checked after the change",
    rows: [
      { label: "Lesson time", before: before.startsAt ? formatSlot(before.startsAt) : "Unknown", after: formatSlot(lesson.starts_at) },
      { label: "Tutor", before: name(before.tutorId), after: lesson.tutors?.name ?? lesson.tutor_id },
      { label: "Time slot", before: before.slotId ?? "None", after: lesson.slot_id ?? "None" },
    ],
    notes: [`Read back from Tutor Compass's records for ${lesson.id}. The request is closed with a note of what changed.`, "Nothing was sent to the family or the tutor."],
    verifiedAt: new Date().toISOString(),
  });
  const student = lesson.bookings?.families?.student_name ?? "your child";
  if (messageFamily) {
    simulated(ctx, "Message confirming the new time", lesson.bookings?.families?.parent_name ?? "The family",
      `Hello,\n\n${student.split(" ")[0]}'s ${lesson.bookings?.subject ?? ""} lesson has moved to ${formatSlot(lesson.starts_at)} with ${lesson.tutors?.name ?? "their tutor"}.\n\nKind regards`);
  }
  return `${lesson.id} now ${formatSlot(lesson.starts_at)} with ${lesson.tutors?.name ?? lesson.tutor_id}`;
}

// ---------------------------------------------------------------------------
// Payment Extension

async function paymentStep(env: Env, d: PaymentData): Promise<Out> {
  const { ctx, today } = env;
  const knewInvoice = Boolean(d.paymentId);
  for (let guard = 0; guard < 10; guard++) {
    const need = paymentNeed(d);
    if (need === "invoice") {
      if (!d.reference) {
        say(ctx, "I couldn't find an invoice reference in that. Which invoice is it? For example INV-503, PAY-2004 or the booking reference BK-1044.");
        return ask("reference");
      }
      const all = await invoicesFor(d.reference);
      const unpaid = all.filter((p) => p.status === "pending" || p.status === "overdue");
      ctx.steps.push({ label: `Looking up invoices for ${d.reference}`, state: unpaid.length === 1 ? "done" : unpaid.length ? "blocked" : "failed" });
      if (!all.length) {
        say(ctx, `I couldn't find an invoice for ${d.reference}. Check the reference and try again, for example INV-503 or BK-1044.`);
        d.reference = "";
        return ask("reference");
      }
      if (!unpaid.length) {
        say(ctx, `${d.reference} has no unpaid invoice (${all.map((p) => `${p.invoice_ref} ${p.status}`).join(", ")}), so there's nothing to extend. Share another reference if you meant a different one.`);
        d.reference = "";
        return ask("reference");
      }
      if (unpaid.length === 1) {
        d.paymentId = unpaid[0].id;
        continue;
      }
      say(ctx, `${d.reference} has ${unpaid.length} unpaid invoices. Which one needs more time?`);
      options(ctx, env.runId, "Choose an invoice", unpaid.map((p) => ({ label: `${p.invoice_ref} · ${formatAud(p.amount_cents)} · due ${p.due_date ? formatDay(p.due_date) : "no date"}`, value: `invoice:${p.id}` })));
      return ask("invoice");
    }

    const inv = await invoiceById(d.paymentId);
    if (!inv || (inv.status !== "pending" && inv.status !== "overdue") || !inv.due_date) {
      say(ctx, inv ? `${inv.invoice_ref} is ${inv.status}${inv.due_date ? "" : " with no due date"}, so there's nothing to extend. Which invoice do you mean?` : "That invoice could not be found. Which invoice do you mean?");
      d.paymentId = "";
      d.reference = "";
      return ask("reference");
    }
    if (!knewInvoice && guard < 9) {
      const [policy, reminders] = await Promise.all([readPolicy(ctx, "payment_extension"), scheduledReminders(inv.id)]);
      const late = daysBetween(inv.due_date, today);
      ctx.blocks.push({
        kind: "found",
        items: [
          `Invoice: ${inv.invoice_ref} (${inv.id}) on ${inv.booking_id}${inv.bookings?.families ? ` for ${inv.bookings.families.student_name}` : ""}.`,
          `Balance: ${formatAud(inv.amount_cents)}, ${inv.status === "overdue" ? "overdue" : "not yet paid"}.`,
          `Due date: ${formatDay(inv.due_date)}${late > 0 ? `, ${late} day${late === 1 ? "" : "s"} ago` : late === 0 ? ", today" : `, in ${-late} day${late === -1 ? "" : "s"}`}.`,
          `Reminders: ${reminders.length ? reminders.map((r) => `${formatDay(r.remind_on)} (${REMINDER_LABELS[r.kind].toLowerCase()})`).join("; ") : "none scheduled"}.`,
          ...(policy ? [`Policy: ${policy.definition.title} (${policyVersionLabel(policy)}).`, ...policyLines(policy)] : ["Policy: none active, so the owner must approve any extension."]),
        ],
        links: policy ? [{ label: "View Policy", href: `/rules/${policy.id}` }] : [],
        note: "Fictional demonstration data. Tutor Compass isn't connected to an invoicing system.",
      });
    }
    if (need === "days") {
      if (d.requestedDate) {
        const diff = daysBetween(inv.due_date, d.requestedDate);
        d.requestedDate = null;
        if (diff >= 1 && diff <= 120) {
          d.extensionDays = diff;
          ctx.steps.push({ label: `New date asked for is ${diff} days after the due date`, state: "done" });
          continue;
        }
        notice(ctx, "warning", "That date isn't after the current due date, so I can't use it.");
      }
      say(ctx, "How many extra days does the family need? You can also give the new due date.");
      options(ctx, env.runId, "Extra days", [7, 14, 30].map((n) => ({ label: `${n} Days`, value: `days:${n}` })));
      return ask("days");
    }
    if (need === "complaint" || need === "welfare") {
      say(ctx, need === "complaint" ? COMPLAINT_Q : WELFARE_Q);
      options(ctx, env.runId, need === "complaint" ? "Complaint" : "Welfare concern", TRI_OPTIONS(need));
      return ask(need);
    }

    const days = d.extensionDays!;
    const newDue = revisedDueDate(inv.due_date, days);
    const reminders = reminderSchedule(newDue, today);
    const summary = `give ${inv.invoice_ref} (${formatAud(inv.amount_cents)}) ${days} extra days, from ${formatDay(inv.due_date)} to ${formatDay(newDue)}`;
    return pipeline(env, d.pipeline, {
      workflow: "payment_extension",
      summary,
      form: {
        requestType: "payment_extension", referenceId: inv.id, bookingId: inv.booking_id, extensionDays: String(days),
        complaint: d.complaint, welfare: d.welfare, context: d.context || `Payment extension in Compass: ${summary}.`,
      },
      applyInputs: { paymentId: inv.id, extensionDays: days },
      beforeSave: () => ctx.blocks.push({
        kind: "found",
        items: [
          `Revised due date: ${formatDay(newDue)} (${days} extra days from ${formatDay(inv.due_date!)}).`,
          `Reminder schedule: ${reminders.map((r) => `${formatDay(r.date)} (${REMINDER_LABELS[r.kind].toLowerCase()})`).join("; ")}.`,
          "Reminders are recorded in Tutor Compass only. None are sent.",
        ],
        links: [],
        note: "Prepared, not saved.",
      }),
      verify: async (r) => {
        const now = await invoiceById(inv.id);
        const list = await scheduledReminders(inv.id);
        const before = (r?.before ?? {}) as { dueDate?: string; status?: string };
        const expected = String((r?.after as { dueDate?: string } | undefined)?.dueDate ?? newDue);
        if (!now || now.due_date !== expected) {
          notice(ctx, "error", "The database said the change was made, but the invoice doesn't read back with the new due date. Check it before telling the family.");
          return "The invoice did not read back as expected.";
        }
        ctx.blocks.push({
          kind: "result",
          title: "Checked after the change",
          rows: [
            { label: "Due date", before: before.dueDate ? formatDay(before.dueDate) : formatDay(inv.original_due_date ?? inv.due_date!), after: formatDay(now.due_date) },
            { label: "Invoice status", before: cap(before.status ?? inv.status), after: cap(now.status) },
            { label: "Reminders", before: "Earlier schedule", after: list.map((x) => `${formatDay(x.remind_on)} (${REMINDER_LABELS[x.kind].toLowerCase()})`).join("; ") || "None" },
          ],
          notes: [`Read back from Tutor Compass's records for ${inv.id}. The request is closed with a note of what changed.`, "No reminder or message was sent, and no invoicing system was changed."],
          verifiedAt: new Date().toISOString(),
        });
        simulated(ctx, "Message confirming the new due date", inv.bookings?.families?.parent_name ?? "The family",
          `Hello,\n\nWe've moved the due date for invoice ${inv.invoice_ref} (${formatAud(inv.amount_cents)}) to ${formatDay(now.due_date)}.\n\nKind regards`);
        return `${inv.invoice_ref} now due ${formatDay(now.due_date)}, ${list.length} reminders scheduled`;
      },
    });
  }
  return ask("reference");
}

// ---------------------------------------------------------------------------
// Tutor Absence

function coverLabel(o: AbsenceData["items"][number]["option"], names: Map<string, string>, slotTimes: Map<string, string>, absentName: string): string {
  if (!o) return "No choice yet";
  if (o.kind === "skip") return "Left as it is";
  if (o.kind === "cover") return `Cover by ${names.get(o.tutorId) ?? o.tutorId} at the same time`;
  return `Move to ${slotTimes.get(o.slotId) ?? o.slotId} with ${absentName}`;
}

async function absenceStep(env: Env, d: AbsenceData): Promise<Out> {
  const { ctx, today } = env;
  const now = new Date();
  const tutors = await allTutors();
  const names = new Map(tutors.map((t) => [t.id, t.name]));
  for (let guard = 0; guard < 12; guard++) {
    const need = absenceNeed(d);
    if (need === "tutor") {
      const hint = d.tutorHint;
      if (!hint) {
        say(ctx, OPENING_QUESTIONS.tutor_absence);
        return ask("tutor");
      }
      const id = /\bT-?(\d{2,6})\b/i.exec(hint);
      const lower = hint.toLowerCase();
      const matches = id
        ? tutors.filter((t) => t.id === `T-${id[1]}`)
        : tutors.filter((t) => lower.includes(t.name.toLowerCase()) || new RegExp(`\\b${t.name.split(" ")[0].toLowerCase()}\\b`).test(lower));
      ctx.steps.push({ label: "Matching the tutor", state: matches.length === 1 ? "done" : "blocked" });
      if (matches.length === 1) {
        d.tutorId = matches[0].id;
        d.tutorHint = matches[0].name;
        continue;
      }
      d.tutorHint = "";
      say(ctx, matches.length ? "More than one tutor matches. Which one is it?" : "I couldn't match a tutor in that. Which tutor is it?");
      options(ctx, env.runId, "Choose a tutor", (matches.length ? matches : tutors).map((t) => ({ label: `${t.name} (${t.id})`, value: `tutor:${t.id}` })));
      return ask("tutor");
    }
    const tutorName = names.get(d.tutorId) ?? d.tutorId;
    if (need === "period") {
      say(ctx, `When is ${tutorName} unavailable? For example "Wednesday", "24 October" or "24 to 26 October".`);
      return ask("period");
    }
    if (d.endsOn < today || daysBetween(d.startsOn, d.endsOn) > 60) {
      say(ctx, d.endsOn < today ? `${formatRange(d.startsOn, d.endsOn)} has already passed. When is ${tutorName} unavailable?` : "Record absences of up to 60 days at a time. When is the tutor unavailable?");
      d.startsOn = "";
      d.endsOn = "";
      return ask("period");
    }
    const period = { tutorId: d.tutorId, startsOn: d.startsOn, endsOn: d.endsOn };
    if (need === "lessons") {
      const all = await tutorLessons(d.tutorId, now);
      const affected = all.filter((l) => isAbsent(d.tutorId, l.starts_at, [period]));
      d.items = affected.slice(0, 20).map((l) => ({ lessonId: l.id, bookingId: l.booking_id, option: null, familyAgreed: null, tutorAgreed: null, pipeline: { requestId: null, pendingProposalId: null, pendingAction: null, applied: false, stopped: false, verified: null, failure: null } }));
      d.lessonsChecked = true;
      ctx.steps.push({ label: `Finding ${tutorName}'s lessons from ${formatRange(d.startsOn, d.endsOn)}`, state: "done" });
      ctx.blocks.push({
        kind: "found",
        items: affected.length
          ? [`${tutorName} is unavailable ${formatRange(d.startsOn, d.endsOn)}. ${affected.length} lesson${affected.length === 1 ? " is" : "s are"} affected:`, ...affected.map((l) => `${lessonLine(l)} (${l.id}).`)]
          : [`${tutorName} has no lessons on the timetable from ${formatRange(d.startsOn, d.endsOn)}.`],
        links: [],
        note: "Fictional demonstration data.",
      });
      continue;
    }
    if (need === "complaint" || need === "welfare") {
      say(ctx, need === "complaint" ? "Has any affected family made a complaint about the service or a tutor?" : "Is there any concern about an affected child's safety or wellbeing? If you're unsure, say so. It won't be treated as no.");
      options(ctx, env.runId, need === "complaint" ? "Complaint" : "Welfare concern", TRI_OPTIONS(need));
      return ask(need);
    }
    if (need === "option") {
      const i = d.items.findIndex((x) => !x.option);
      const lesson = await lessonById(d.items[i].lessonId);
      if (!lesson || lesson.status !== "scheduled") {
        d.items[i] = { ...d.items[i], option: { kind: "skip" } };
        notice(ctx, "info", `${d.items[i].lessonId} is no longer scheduled, so I've left it out.`);
        continue;
      }
      const [slots, abs, busy] = await Promise.all([freeSlots(tutors.map((t) => t.id), now), absences(tutors.map((t) => t.id)), familyBusy(lesson.bookings?.family_id ?? "", lesson.id)]);
      const allAbs = [...abs, period];
      const lessonLite = {
        id: lesson.id, tutorId: lesson.tutor_id, startsAt: new Date(lesson.starts_at).toISOString(), endsAt: new Date(lesson.ends_at).toISOString(),
        subject: lesson.bookings?.subject ?? "", courseId: lesson.bookings?.course_id ?? null, yearLevel: lesson.bookings?.year_level ?? null,
      };
      const covers = coverCandidates(lessonLite, tutors, slots, allAbs, busy);
      const moves = pickAlternatives(slots.filter((s) => s.tutorId === lesson.tutor_id), { now, lesson: lessonLite, busy, absences: allAbs, dayHint: null, partHint: null, limit: 3, after: d.endsOn });
      ctx.steps.push({ label: `Checking cover tutors and ${tutorName}'s later times for ${lesson.id}`, state: covers.length || moves.length ? "done" : "blocked" });
      say(ctx, `Lesson ${i + 1} of ${d.items.length}: ${lessonLine(lesson)}. ${covers.length ? "A cover tutor always needs the owner's approval, because no owner rule covers a change of tutor. " : "No cover tutor who teaches this is free at that time. "}${moves.length ? `Moving it to a later time with ${tutorName} follows the lesson change rules.` : `${tutorName} has no free time after the absence that fits.`} What should happen?`);
      options(ctx, env.runId, `Lesson ${i + 1} of ${d.items.length}`, [
        ...covers.map((c) => ({ label: `Cover: ${c.tutor.name}, Same Time`, value: `option:cover:${c.tutor.id}:${c.slot.id}` })),
        ...moves.map((s) => ({ label: `Move: ${formatSlot(s.startsAt)}`, value: `option:move:${s.id}` })),
        { label: "Leave This Lesson for Now", value: "option:skip" },
      ]);
      return ask("option");
    }
    if (need === "agreement") {
      const i = d.items.findIndex((x) => needsAgreement(x));
      const item = d.items[i];
      const kind = needsAgreement(item)!;
      const lesson = await lessonById(item.lessonId);
      const slot = item.option && item.option.kind !== "skip" ? await slotById(item.option.slotId) : null;
      const student = lesson?.bookings?.families?.student_name ?? "the student";
      const change = item.option?.kind === "cover"
        ? `${names.get(item.option.tutorId)} covering ${student}'s lesson on ${lesson ? formatSlot(lesson.starts_at) : ""}`
        : `moving ${student}'s lesson from ${lesson ? formatSlot(lesson.starts_at) : ""} to ${slot ? formatSlot(slot.startsAt) : ""} with ${tutorName}`;
      if (env.later === kind) {
        if (kind === "family") {
          simulated(ctx, "Message asking the family to agree", lesson?.bookings?.families?.parent_name ?? "The family",
            `Hello,\n\n${tutorName} is unavailable ${formatRange(d.startsOn, d.endsOn)}. We'd like to arrange ${change}. Please let us know if that suits. Nothing changes until you reply.\n\nKind regards`);
        } else {
          simulated(ctx, "Message asking the tutor to cover", names.get((item.option as { tutorId: string }).tutorId) ?? "The tutor",
            `Hello,\n\nCould you cover ${student}'s ${lesson?.bookings?.subject ?? ""} lesson on ${lesson ? formatSlot(lesson.starts_at) : ""} while ${tutorName} is away? Nothing is booked until you confirm.\n\nThanks`);
        }
        say(ctx, "When they agree, come back and press Continue. This stays under What Needs My Attention? until then.");
        options(ctx, env.runId, "Agreement", kind === "family"
          ? [{ label: "Family Agreed", value: "family:yes" }]
          : [{ label: "Tutor Agreed", value: "tutorok:yes" }]);
        return waiting(kind === "family" ? "waiting_family" : "waiting_tutor", "agreement");
      }
      say(ctx, kind === "family" ? `Has the family agreed to ${change}?` : `Has ${names.get((item.option as { tutorId: string }).tutorId)} agreed to cover ${student}'s lesson on ${lesson ? formatSlot(lesson.starts_at) : ""}?`);
      options(ctx, env.runId, "Agreement", kind === "family"
        ? [{ label: "Family Agreed", value: "family:yes" }, { label: "Not Yet, Prepare a Message", value: "family:later" }]
        : [{ label: "Tutor Agreed", value: "tutorok:yes" }, { label: "Not Yet, Prepare a Message", value: "tutorok:later" }]);
      return ask("agreement");
    }
    if (need === "record") {
      if (d.absenceProposalId) {
        const o = await followProposal(d.absenceProposalId, ctx.user.id);
        if (o?.status === "pending") {
          say(ctx, "The absence is still waiting for your confirmation. Confirm it to go on.");
          try {
            ctx.blocks.push({ kind: "proposal", proposal: await proposalView(ctx.user, o.id), intro: null, next: { label: "Continue", command: continueCommand(env.runId) } });
          } catch { /* ignore */ }
          return confirmOut();
        }
        d.absenceProposalId = null;
        if (o?.status === "succeeded" && typeof o.result?.absenceId === "string") {
          d.absenceId = o.result.absenceId;
          ctx.steps.push({ label: `Absence recorded for ${tutorName}`, state: "done" });
          continue;
        }
        if (o?.status === "failed") notice(ctx, "error", `Recording the absence didn't go through: ${String(o.result?.error ?? "").replace(/^[a-z_]+:\s*/, "")}. Nothing was changed.`);
      }
      const p = { requestId: null, pendingProposalId: null as string | null, pendingAction: null, applied: false, stopped: false, verified: null, failure: null };
      const out = await prepareAndShow(env, p as Pipeline, { action: "tutor.record_absence", inputs: { tutorId: d.tutorId, startsOn: d.startsOn, endsOn: d.endsOn, note: d.context.slice(0, 500) } },
        d.items.length ? "Next, record the absence. This doesn't move any lesson yet: each change is confirmed after it." : "Record the absence. No lessons need to change.");
      d.absenceProposalId = p.pendingProposalId;
      return out;
    }
    if (need === "pipeline") {
      const i = currentItem(d);
      const item = d.items[i];
      const lesson = await lessonById(item.lessonId);
      const opt = item.option!;
      if (!lesson || lesson.status !== "scheduled" || opt.kind === "skip") {
        item.pipeline.stopped = true;
        notice(ctx, "info", `${item.lessonId} is no longer scheduled, so nothing was changed for it.`);
        continue;
      }
      const slot = await slotById(opt.slotId);
      const student = lesson.bookings?.families?.student_name ?? "the student";
      const desc = opt.kind === "cover"
        ? `${names.get(opt.tutorId)} covers ${student}'s lesson ${lesson.id} on ${formatSlot(lesson.starts_at)} while ${tutorName} is away`
        : `move ${student}'s lesson ${lesson.id} from ${formatSlot(lesson.starts_at)} to ${slot ? formatSlot(slot.startsAt) : opt.slotId} with ${tutorName}`;
      if (!item.pipeline.requestId && !item.pipeline.pendingProposalId) say(ctx, `Lesson ${i + 1} of ${d.items.length}: ${desc}.`);
      const out = await pipeline(env, item.pipeline, {
        workflow: "tutor_absence",
        summary: desc,
        form: {
          requestType: "lesson_change", referenceId: item.bookingId, bookingId: item.bookingId, proposedSlotId: opt.slotId,
          financialImpact: "no", complaint: d.complaint, welfare: d.welfare,
          context: `Tutor absence: ${tutorName} is unavailable ${formatRange(d.startsOn, d.endsOn)}. Plan: ${desc}.`,
        },
        applyInputs: {
          lessonId: lesson.id, newSlotId: opt.slotId,
          agreement: `The family agreed${opt.kind === "cover" ? ` and ${names.get(opt.tutorId)} agreed to cover` : ""}, as confirmed by ${ctx.user.displayName} in Compass.`,
        },
        verify: (r) => verifyLesson(ctx, lesson.id, r, false),
      });
      if (out.status === "completed") continue;
      return out;
    }
    // done
    const slotTimes = new Map<string, string>();
    for (const it of d.items) if (it.option && it.option.kind !== "skip") { const s = await slotById(it.option.slotId); if (s) slotTimes.set(s.id, formatSlot(s.startsAt)); }
    const lines = d.items.map((it) => `${it.lessonId}: ${it.pipeline.applied ? `${coverLabel(it.option, names, slotTimes, tutorName)}. Done and checked.` : it.option?.kind === "skip" ? `Left as it is. ${tutorName} is recorded as away, so arrange this lesson yourself.` : "Not changed (declined or closed elsewhere)."}`);
    ctx.blocks.push({ kind: "found", items: [`${tutorName}: absence recorded for ${formatRange(d.startsOn, d.endsOn)}.`, ...lines], links: [], note: "Nothing was sent to any family or tutor." });
    say(ctx, d.items.some((it) => it.option?.kind === "skip" || it.pipeline.stopped) ? "That's everything I can do here. Some lessons still need you, listed above." : "All done. Every change was confirmed and read back from the records.");
    return { awaiting: null, status: "completed", stage: "done", mood: "success" };
  }
  return ask("tutor");
}

