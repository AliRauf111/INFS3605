import "server-only";
import { ApiError } from "@/lib/api/handler";
import { logActivity } from "@/lib/agent/activity";
import { actionLabel, type ProposalAction } from "@/lib/agent/permissions";
import { cancelProposal, prepareProposal, proposalView, workflowSetupMessage } from "@/lib/agent/proposals";
import { approvedProcedures } from "@/lib/agent/reads";
import { screenSensitive } from "@/lib/agent/sensitive";
import { numberWordsToDigits } from "@/lib/agent/intents";
import type { TurnCtx } from "@/lib/assistant/owner";
import { matchStudents, type Block, type Command, type Mood } from "@/lib/assistant/logic";
import { WORKFLOW_LABELS, type WorkflowId } from "@/lib/assistant/shortcuts";
import { getActivePolicy, resolveBooking } from "@/lib/context/retrieve";
import { formatAud } from "@/lib/domain/money";
import type { RequestStatus, TriState } from "@/lib/domain/types";
import { CATEGORY_CONFIG, describeRange, policyVersionLabel, type PolicySnapshot } from "@/lib/engine/policy";
import type { FactsForm } from "@/lib/validation/facts";
import { replyFormat, tr } from "@/lib/i18n/reply";
import { reminderLabel, type ReminderKind, daysBetween, formatDay, formatRange, formatSlot, hoursUntil, parseExtension, parseRange, reminderSchedule, sydneyToday } from "./dates";
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
  { label: tr("reply.common.yes"), value: `${field}:yes` },
  { label: tr("reply.common.no"), value: `${field}:no` },
  { label: tr("reply.common.notSure"), value: `${field}:unsure` },
];

function options(ctx: TurnCtx, runId: string, label: string, list: Array<{ label: string; value: string }>, op: "pick" | "decide" = "pick") {
  ctx.blocks.push({ kind: "options", label, options: withChoices(runId, list.map((o) => ({ label: o.label, command: { type: "workflow", runId, op, value: o.value } as Command }))) });
}

const continueCommand = (runId: string): Command => ({ type: "workflow", runId, op: "continue" });

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function triText(v: TriState | null): string {
  return tr(`reply.tri.${v ?? "unanswered"}`);
}

const COMPLAINT_Q = () => tr("reply.wf.complaintQ");
const WELFARE_Q = () => tr("reply.wf.welfareQ");
const workflowName = (id: WorkflowId) => tr(`reply.workflow.${id}`);
const statusLabel = (s: RequestStatus) => tr(`domain.status.${s}`);

// ---------------------------------------------------------------------------
// Entry point

export async function runWorkflow(ctx: TurnCtx, input: WorkflowInput, active: ActiveRun | null): Promise<{ mood: Mood; run: ActiveRun | null }> {
  ctx.modeNote = ctx.live ? tr("reply.wf.modeLive") : tr("reply.wf.modeDemo");
  try {
    return await runInner(ctx, input, active);
  } catch (e) {
    if (e instanceof WorkflowsNotSetUp) {
      notice(ctx, "error", workflowSetupMessage());
      return { mood: "error", run: null };
    }
    if (e instanceof ApiError && e.status === 503) {
      notice(ctx, "error", e.message);
      return { mood: "error", run: active };
    }
    console.error("[compass] workflow failed:", e instanceof Error ? e.message : e);
    notice(ctx, "error", tr("reply.wf.readFailed"));
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
      ctx.steps.push({ label: tr("reply.wf.starting", { workflow: workflowName(input.start) }), state: "done" });
      return runInner(ctx, { runId: row.id, text: input.text }, { id: row.id, workflow: input.start });
    }
    say(ctx, tr(`reply.opening.${input.start}`));
    ctx.blocks.push({ kind: "options", label: tr("reply.common.or"), options: withChoices(row.id, [{ label: tr("reply.common.attention"), command: { type: "attention" } }], input.start) });
    return { mood: "clarify", run: { id: row.id, workflow: input.start } };
  }

  const runId = input.runId ?? active?.id;
  const row = runId ? await loadRun(runId, ctx.user.id) : null;
  if (!row) {
    notice(ctx, "warning", tr("reply.wf.notFound"));
    return { mood: "clarify", run: null };
  }
  const run: ActiveRun = { id: row.id, workflow: row.workflow };
  const parsed = RunStateSchema.safeParse(row.state);
  if (!parsed.success) {
    notice(ctx, "error", tr("reply.wf.unreadable"));
    return { mood: "error", run: null };
  }
  if (row.status === "completed" || row.status === "cancelled") {
    say(ctx, `${tr(row.status === "completed" ? "reply.wf.alreadyFinished" : "reply.wf.alreadyCancelled", { workflow: workflowName(row.workflow) })}${row.summary ? ` ${row.summary}.` : ""}`);
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
    say(ctx, `${tr("reply.wf.stopped", { workflow: workflowName(row.workflow) })} ${tr(anyApplied(data) ? "reply.wf.stoppedKept" : "reply.common.nothingChanged")}`);
    return { mood: "neutral", run: null };
  }
  if (input.op === "pick" && input.value) {
    const next = applyPick(data, input.value);
    if (!next) notice(ctx, "warning", tr("reply.wf.optionGone"));
    else {
      data = next;
      if (/^(family|tutorok):later$/.test(input.value)) later = input.value.startsWith("family") ? "family" : "tutor";
      if (input.value === "slot:waiting") later = "family";
    }
  }
  if (input.op === "decide" && input.value) decision = input.value;
  if (input.text) {
    const text = input.text;
    const flagged = ctx.blocks.some((b) => b.kind === "notice" && b.text.startsWith(tr("reply.sensitiveNote")));
    if (screenSensitive(text).sensitive && !flagged) {
      notice(ctx, "warning", `${tr("reply.sensitiveNote")} ${tr("reply.wf.atRisk")}`);
      await logActivity({ sessionKey: ctx.sessionKey, actorId: ctx.user.id, mode: "system", eventType: "sensitive_case_routed", state: "completed", summary: "A Compass workflow message may describe a welfare concern. It stayed on our server." });
    }
    if (/^\s*(cancel|stop|never ?mind|start again)\s*[.!]?\s*$/i.test(text)) return runInner(ctx, { op: "cancel", runId: row.id }, active);
    data = applyText(data, awaiting, text, today);
    if (JSON.stringify(data) === before && awaiting && awaiting !== "start") notice(ctx, "info", tr("reply.wf.didntCatch"));
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
  return [d.tutorId ? `${d.tutorHint || d.tutorId} (${d.tutorId})` : "", d.startsOn ? formatRange(d.startsOn, d.endsOn, "en-AU") : "", d.lessonsChecked ? `${d.items.length} lesson${d.items.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "Tutor not chosen yet";
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

function policyLines(p: PolicySnapshot): string[] {
  return p.definition.rules.map((r) => {
    const when = CATEGORY_CONFIG[p.category].numeric ? describeRange(p.category, r.range, tr, replyFormat()) : tr(`reply.wf.fee.${r.financialImpact === "yes" || r.financialImpact === "no" ? r.financialImpact : "any"}`);
    return tr("reply.wf.policyLine", { rule: r.label, when, colour: tr(`reply.colour.${r.colour}`), who: tr(`reply.wf.who.${r.colour}`) });
  });
}

function simulated(ctx: TurnCtx, title: string, to: string, body: string) {
  ctx.blocks.push({ kind: "simulated", title, to, body, note: tr("reply.wf.simulatedNote") });
}

async function prepareAndShow(env: Env, p: Pipeline, body: Record<string, unknown>, intro: string): Promise<Out> {
  const { ctx } = env;
  try {
    const proposal = await prepareProposal(ctx.user, { sessionKey: ctx.sessionKey, ...body });
    p.pendingProposalId = proposal.id;
    p.pendingAction = proposal.action;
    p.failure = null;
    ctx.blocks.push({ kind: "proposal", proposal, intro, next: { label: tr("reply.common.continue"), command: continueCommand(env.runId) } });
    return confirmOut();
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) throw e;
    const msg = e instanceof ApiError ? e.message : tr("reply.wf.couldntPrepare");
    notice(ctx, "error", msg);
    p.failure = msg.slice(0, 400);
    say(ctx, tr("reply.wf.fixAndContinue"));
    ctx.blocks.push({ kind: "options", label: tr("reply.common.next"), options: [
      { label: tr("reply.common.continue"), command: continueCommand(env.runId) },
      { label: tr("reply.wf.stopWorkflow"), command: { type: "workflow", runId: env.runId, op: "cancel" } },
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
      say(ctx, tr("reply.wf.previewWaiting"));
      try {
        const proposal = await proposalView(ctx.user, o.id);
        ctx.blocks.push({ kind: "proposal", proposal, intro: null, next: { label: tr("reply.common.continue"), command: continueCommand(env.runId) } });
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
        ctx.steps.push({ label: tr("reply.wf.requestSaved"), state: "done" });
      } else if (o.action === apply) {
        p.applied = true;
        appliedResult = o.result;
      } else {
        ctx.steps.push({ label: tr("reply.wf.actionRecorded", { action: actionLabel(o.action) }), state: "done" });
      }
    } else if (o?.status === "failed") {
      const why = String(o.result?.error ?? tr("reply.wf.dbRefused")).replace(/^[a-z_]+:\s*/, "");
      p.failure = why.slice(0, 400);
      notice(ctx, "error", tr("reply.wf.didntGoThrough", { why }));
    } else if (o) {
      notice(ctx, "info", tr("reply.wf.lastPreview", { status: tr(`reply.proposalStatus.${o.status as "pending"}`) }));
    }
  }

  if (p.applied) {
    if (!p.verified) {
      say(ctx, tr("reply.wf.doneReadBack"));
      p.verified = (await spec.verify(appliedResult)).slice(0, 800);
      await logActivity({ sessionKey: ctx.sessionKey, requestId: p.requestId, actorId: ctx.user.id, mode: "system", eventType: "workflow_step", state: "completed", summary: `Compass read the records back after the change: ${p.verified}`.slice(0, 500) });
    }
    return { awaiting: null, status: "completed", stage: "done", mood: "success" };
  }

  const req = p.requestId ? await requestState(p.requestId) : null;
  const need = pipelineNeed(p, req, ctx.user.role);
  const reqLink = p.requestId ? { label: tr("reply.common.openRequest"), href: `/requests/${p.requestId}` } : null;
  switch (need) {
    case "save":
      spec.beforeSave?.();
      return prepareAndShow(env, p, { action: "request.create", facts: spec.form },
        tr("reply.wf.saveFirst"));
    case "apply":
      return prepareAndShow(env, p, { action: apply, requestId: p.requestId!, inputs: spec.applyInputs },
        tr(req?.status === "approved" ? "reply.wf.applyApproved" : "reply.wf.applyAllowed"));
    case "owner_decision": {
      const d = env.decision ? DECISIONS[env.decision] : undefined;
      if (d) return prepareAndShow(env, p, { action: d.action, requestId: p.requestId!, note: d.note(spec.summary) }, tr("reply.wf.decisionPreview"));
      say(ctx, tr("reply.wf.ownerDecideHere"));
      options(ctx, env.runId, tr("reply.wf.yourDecision"), [
        { label: tr("reply.common.approve"), value: "approve" },
        { label: tr("reply.common.decline"), value: "decline" },
        { label: tr("reply.common.askInfo"), value: "request_info" },
      ], "decide");
      if (reqLink) ctx.blocks.push({ kind: "found", items: [tr("reply.wf.requestLine", { reference: req?.reference ?? "", status: statusLabel(req!.status) })], links: [reqLink] });
      return ask("decision");
    }
    case "send_to_owner":
      return prepareAndShow(env, p, { action: "request.send_to_owner", requestId: p.requestId!, note: `Please review: ${spec.summary}.` },
        tr("reply.wf.sendIntro"));
    case "waiting_owner":
      say(ctx, tr(ctx.user.role === "owner" ? "reply.wf.waitingOwnerOwner" : "reply.wf.waitingOwnerAdmin"));
      if (reqLink) ctx.blocks.push({ kind: "found", items: [tr("reply.wf.requestLine", { reference: req?.reference ?? "", status: req ? statusLabel(req.status) : "" })], links: [reqLink] });
      return waiting("waiting_owner");
    case "complete_details":
      say(ctx, tr("reply.wf.completeDetails"));
      ctx.blocks.push({ kind: "found", items: [tr("reply.wf.requestRef", { reference: req?.reference ?? "" })], links: [{ label: tr("reply.common.completeDetails"), href: `/requests/${p.requestId}?details=1` }] });
      ctx.blocks.push({ kind: "options", label: tr("reply.common.next"), options: withChoices(env.runId, [{ label: tr("reply.common.continue"), command: continueCommand(env.runId) }]) });
      return waiting("complete_details");
    case "declined":
      p.stopped = true;
      say(ctx, tr("reply.wf.declined"));
      if (reqLink) ctx.blocks.push({ kind: "found", items: [tr("reply.wf.requestLine", { reference: req?.reference ?? "", status: statusLabel("declined") })], links: [reqLink] });
      return { awaiting: null, status: "completed", stage: "declined", mood: "neutral" };
    case "closed_elsewhere":
      p.stopped = true;
      say(ctx, tr("reply.wf.closedElsewhere"));
      return { awaiting: null, status: "completed", stage: "closed_elsewhere", mood: "neutral" };
    case "confirm":
    case "done":
      return { awaiting: null, status: "completed", stage: "done", mood: "success" };
  }
}

function lessonLine(l: LessonRow): string {
  const b = l.bookings;
  return tr("reply.wf.lessonLine", { student: b?.families?.student_name ?? b?.id ?? l.booking_id, subject: b?.subject ?? tr("reply.wf.lesson"), time: formatSlot(l.starts_at), tutor: l.tutors?.name ?? l.tutor_id });
}

const reminderList = (list: Array<{ date: string; kind: ReminderKind }>) =>
  list.map((r) => tr("reply.pay.reminderItem", { date: formatDay(r.date), kind: reminderLabel(r.kind).toLowerCase() })).join("; ");

async function readPolicy(ctx: TurnCtx, category: "lesson_change" | "payment_extension"): Promise<PolicySnapshot | null> {
  const policy = await getActivePolicy(category);
  ctx.steps.push({ label: policy ? tr("reply.wf.readingPolicy", { version: policyVersionLabel(policy) }) : tr("reply.wf.readingPolicyNone"), state: policy ? "done" : "blocked" });
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
        ctx.steps.push({ label: tr("reply.lesson.lookingFor", { student: d.studentHint }), state: families.length === 1 ? "done" : "blocked" });
        if (families.length === 1) {
          d.reference = families[0].id;
          continue;
        }
        say(ctx, tr(families.length ? "reply.lesson.manyStudents" : "reply.lesson.noStudent", { student: d.studentHint }));
        d.studentHint = "";
        return ask("reference");
      }
      if (!d.reference) {
        say(ctx, tr("reply.lesson.noReference"));
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
        ctx.steps.push({ label: tr("reply.lesson.foundBooking", { booking: b.row.id, subject: b.row.subject, student: b.row.families?.student_name ?? tr("reply.wf.theStudent"), tutor: b.row.tutors?.name ?? b.row.tutor_id }), state: "done" });
        continue;
      }
      if (b.status === "multiple") {
        ctx.steps.push({ label: tr("reply.lesson.findingBooking"), state: "blocked" });
        say(ctx, tr("reply.lesson.manyBookings", { reference: b.reference }));
        options(ctx, env.runId, tr("reply.lesson.chooseBooking"), b.candidates.map((c) => ({ label: c.label, value: `booking:${c.id}` })));
        return ask("booking");
      }
      ctx.steps.push({ label: tr("reply.lesson.findingBooking"), state: "failed" });
      say(ctx, tr("reply.lesson.noBooking", { reference: d.reference }));
      d.reference = "";
      return ask("reference");
    }
    if (need === "lesson") {
      const lessons = await upcomingLessons(d.bookingId, now);
      ctx.steps.push({ label: tr("reply.lesson.readingLessons", { booking: d.bookingId }), state: lessons.length ? "done" : "blocked" });
      if (!lessons.length) {
        say(ctx, tr("reply.lesson.noLessons", { booking: d.bookingId }));
        d.bookingId = "";
        d.reference = "";
        return ask("reference");
      }
      if (lessons.length === 1) {
        d.lessonId = lessons[0].id;
        continue;
      }
      say(ctx, tr("reply.lesson.whichLesson"));
      options(ctx, env.runId, tr("reply.lesson.chooseLesson"), lessons.slice(0, 8).map((l) => ({ label: tr("reply.lesson.slotWith", { time: formatSlot(l.starts_at), tutor: l.tutors?.name ?? l.tutor_id }), value: `lesson:${l.id}` })));
      return ask("lesson");
    }

    const lesson = await lessonById(d.lessonId);
    if (!lesson || lesson.status !== "scheduled" || new Date(lesson.starts_at) <= now) {
      say(ctx, tr("reply.lesson.notScheduled"));
      d.lessonId = "";
      d.slotId = "";
      continue;
    }
    if (!knewLesson && guard < 9) {
      await showLessonFound(ctx, d, lesson, now);
    }

    if (need === "complaint" || need === "welfare") {
      say(ctx, need === "complaint" ? COMPLAINT_Q() : WELFARE_Q());
      options(ctx, env.runId, tr(need === "complaint" ? "reply.wf.complaint" : "reply.wf.welfare"), TRI_OPTIONS(need));
      return ask(need);
    }
    const tutorId = lesson.bookings?.tutor_id ?? lesson.tutor_id;
    if (need === "slot") {
      const [slots, busy, abs] = await Promise.all([freeSlots([tutorId], now), familyBusy(lesson.bookings?.family_id ?? "", lesson.id), absences([tutorId])]);
      const alts = pickAlternatives(slots, { now, lesson: { startsAt: lesson.starts_at, endsAt: lesson.ends_at }, busy, absences: abs, dayHint: d.dayHint, partHint: d.partHint });
      const tutorName = lesson.bookings?.tutor_id === lesson.tutor_id ? lesson.tutors?.name ?? tutorId : tutorId;
      ctx.steps.push({ label: tr("reply.lesson.checkingTimes", { tutor: tutorName }), state: alts.length ? "done" : "blocked" });
      if (!alts.length) {
        say(ctx, tr("reply.lesson.noTimes", { tutor: tutorName, hours: NOTICE_HOURS }));
        d.pipeline.stopped = true;
        return { awaiting: null, status: "completed", stage: "no_times", mood: "clarify" };
      }
      // The message to the family is written in English, like every other draft to families.
      const student = lesson.bookings?.families?.student_name ?? "your child";
      if (d.parentChoice === "waiting" && env.later) {
        simulated(ctx, tr("reply.lesson.msgOfferTitle"), lesson.bookings?.families?.parent_name ?? tr("reply.wf.theFamily"),
          `Hello,\n\nWe need to find a new time for ${student.split(" ")[0]}'s ${lesson.bookings?.subject ?? ""} lesson on ${formatSlot(lesson.starts_at, "en-AU")}. ${tutorName} is free at:\n${alts.map((s) => `- ${formatSlot(s.startsAt, "en-AU")}`).join("\n")}\n\nPlease let us know which suits. Nothing changes until you reply.\n\nKind regards`);
        say(ctx, tr("reply.lesson.msgOfferSay"));
        options(ctx, env.runId, tr("reply.lesson.familyChoice"), alts.map((s) => ({ label: formatSlot(s.startsAt), value: `slot:${s.id}` })));
        return waiting("waiting_family", "slot");
      }
      const wanted = d.dayHint !== null || d.partHint ? ` ${tr("reply.lesson.nearestFirst")}` : "";
      say(ctx, `${tr("reply.lesson.freeAt", { tutor: tutorName, hours: NOTICE_HOURS })}${wanted} ${tr("reply.lesson.whichTime")}`);
      options(ctx, env.runId, tr("reply.lesson.familyChoice"), [
        ...alts.map((s) => ({ label: formatSlot(s.startsAt), value: `slot:${s.id}` })),
        { label: tr("reply.lesson.notChosen"), value: "slot:waiting" },
      ]);
      return ask("slot");
    }
    const slot = await slotById(d.slotId);
    // Once the move is prepared or done, the slot is ours: the database checks it again on confirm.
    const committed = d.pipeline.applied || d.pipeline.stopped || (d.pipeline.pendingAction === APPLY_ACTION.lesson_change && Boolean(d.pipeline.pendingProposalId));
    if (!slot || (slot.status !== "free" && !committed)) {
      notice(ctx, "warning", tr("reply.lesson.slotGone"));
      d.slotId = "";
      d.parentChoice = null;
      continue;
    }
    if (need === "financialImpact") {
      const sameLength = new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime() === new Date(lesson.ends_at).getTime() - new Date(lesson.starts_at).getTime();
      if (sameLength && slot.tutorId === tutorId) {
        d.financialImpact = "no";
        ctx.steps.push({ label: tr("reply.lesson.sameFees"), state: "done" });
        continue;
      }
      say(ctx, tr("reply.lesson.feesQ"));
      options(ctx, env.runId, tr("reply.lesson.fees"), TRI_OPTIONS("fee"));
      return ask("fee");
    }

    // The summary goes into notes to the owner and the request record, so it stays in English.
    const student = lesson.bookings?.families?.student_name ?? "the student";
    const summary = `move ${student}'s lesson ${lesson.id} (${lesson.bookings?.subject ?? ""}) from ${formatSlot(lesson.starts_at, "en-AU")} to ${formatSlot(slot.startsAt, "en-AU")} with ${slot.tutorName}`;
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
  // Knowledge Hub articles are the owner's own text, so they are quoted as written.
  const items = [
    tr("reply.lesson.foundLesson", { lesson: lessonLine(lesson), id: lesson.id }),
    tr("reply.lesson.foundBookingLine", { booking: lesson.booking_id }),
    ...(policy ? [tr("reply.wf.policyTitle", { title: policy.definition.title, version: policyVersionLabel(policy) }), ...policyLines(policy)] : [tr("reply.lesson.noPolicy")]),
    ...(kb ? [`${kb.id} ${kb.title}: ${kb.body.split(/(?<=[.])\s/)[0]}`] : []),
    tr("reply.wf.fromMessage", { complaint: triText(d.complaint).toLowerCase(), welfare: triText(d.welfare).toLowerCase() }),
  ];
  ctx.blocks.push({ kind: "found", items, links: policy ? [{ label: tr("reply.wf.viewPolicy"), href: `/rules/${policy.id}` }] : [], note: tr("reply.wf.demoData") });
  if (hours < NOTICE_HOURS) {
    notice(ctx, "warning", tr("reply.lesson.shortNotice", { hours: NOTICE_HOURS, procedure: kb?.id ?? tr("reply.lesson.procedure") }));
  }
}

/** Reads the lesson back after the change. The returned line is saved, so it is in English. */
async function verifyLesson(ctx: TurnCtx, lessonId: string, result: Record<string, unknown> | null, messageFamily: boolean): Promise<string> {
  const lesson = await lessonById(lessonId);
  const after = (result?.after ?? {}) as { slotId?: string; startsAt?: string };
  const before = (result?.before ?? {}) as { slotId?: string; tutorId?: string; startsAt?: string };
  const tutors = await allTutors();
  const name = (id?: string) => tutors.find((t) => t.id === id)?.name ?? id ?? tr("reply.wf.unknown");
  const ok = Boolean(lesson && lesson.status === "scheduled" && (!after.slotId || lesson.slot_id === after.slotId));
  if (!lesson || !ok) {
    notice(ctx, "error", tr("reply.lesson.readBackFailed"));
    return "The lesson did not read back as expected.";
  }
  ctx.blocks.push({
    kind: "result",
    title: tr("reply.wf.checkedTitle"),
    rows: [
      { label: tr("reply.lesson.rowTime"), before: before.startsAt ? formatSlot(before.startsAt) : tr("reply.wf.unknown"), after: formatSlot(lesson.starts_at) },
      { label: tr("reply.lesson.rowTutor"), before: name(before.tutorId), after: lesson.tutors?.name ?? lesson.tutor_id },
      { label: tr("reply.lesson.rowSlot"), before: before.slotId ?? tr("reply.wf.none"), after: lesson.slot_id ?? tr("reply.wf.none") },
    ],
    notes: [tr("reply.wf.readBackNote", { id: lesson.id }), tr("reply.lesson.nothingSent")],
    verifiedAt: new Date().toISOString(),
  });
  const student = lesson.bookings?.families?.student_name ?? "your child";
  if (messageFamily) {
    simulated(ctx, tr("reply.lesson.msgConfirmTitle"), lesson.bookings?.families?.parent_name ?? tr("reply.wf.theFamily"),
      `Hello,\n\n${student.split(" ")[0]}'s ${lesson.bookings?.subject ?? ""} lesson has moved to ${formatSlot(lesson.starts_at, "en-AU")} with ${lesson.tutors?.name ?? "their tutor"}.\n\nKind regards`);
  }
  return `${lesson.id} now ${formatSlot(lesson.starts_at, "en-AU")} with ${lesson.tutors?.name ?? lesson.tutor_id}`;
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
        say(ctx, tr("reply.pay.noReference"));
        return ask("reference");
      }
      const all = await invoicesFor(d.reference);
      const unpaid = all.filter((p) => p.status === "pending" || p.status === "overdue");
      ctx.steps.push({ label: tr("reply.pay.lookingUp", { reference: d.reference }), state: unpaid.length === 1 ? "done" : unpaid.length ? "blocked" : "failed" });
      if (!all.length) {
        say(ctx, tr("reply.pay.noInvoice", { reference: d.reference }));
        d.reference = "";
        return ask("reference");
      }
      if (!unpaid.length) {
        say(ctx, tr("reply.pay.noneUnpaid", { reference: d.reference, list: all.map((p) => `${p.invoice_ref} ${invoiceStatus(p.status)}`).join(", ") }));
        d.reference = "";
        return ask("reference");
      }
      if (unpaid.length === 1) {
        d.paymentId = unpaid[0].id;
        continue;
      }
      say(ctx, tr("reply.pay.manyUnpaid", { reference: d.reference, count: unpaid.length }));
      options(ctx, env.runId, tr("reply.pay.chooseInvoice"), unpaid.map((p) => ({ label: tr("reply.pay.invoiceOption", { invoice: p.invoice_ref, amount: formatAud(p.amount_cents), due: p.due_date ? formatDay(p.due_date) : tr("reply.pay.noDate") }), value: `invoice:${p.id}` })));
      return ask("invoice");
    }

    const inv = await invoiceById(d.paymentId);
    if (!inv || (inv.status !== "pending" && inv.status !== "overdue") || !inv.due_date) {
      say(ctx, inv ? tr(inv.due_date ? "reply.pay.cantExtend" : "reply.pay.cantExtendNoDate", { invoice: inv.invoice_ref, status: invoiceStatus(inv.status) }) : tr("reply.pay.notFound"));
      d.paymentId = "";
      d.reference = "";
      return ask("reference");
    }
    if (!knewInvoice && guard < 9) {
      const [policy, reminders] = await Promise.all([readPolicy(ctx, "payment_extension"), scheduledReminders(inv.id)]);
      const late = daysBetween(inv.due_date, today);
      const student = inv.bookings?.families?.student_name;
      ctx.blocks.push({
        kind: "found",
        items: [
          tr(student ? "reply.pay.invoiceLineFor" : "reply.pay.invoiceLine", { invoice: inv.invoice_ref, id: inv.id, booking: inv.booking_id, student }),
          tr(inv.status === "overdue" ? "reply.pay.balanceOverdue" : "reply.pay.balanceUnpaid", { amount: formatAud(inv.amount_cents) }),
          late > 0 ? tr("reply.pay.dueAgo", { date: formatDay(inv.due_date), count: late }) : late === 0 ? tr("reply.pay.dueToday", { date: formatDay(inv.due_date) }) : tr("reply.pay.dueIn", { date: formatDay(inv.due_date), count: -late }),
          reminders.length ? tr("reply.pay.reminders", { list: reminderList(reminders.map((r) => ({ date: r.remind_on, kind: r.kind }))) }) : tr("reply.pay.remindersNone"),
          ...(policy ? [tr("reply.wf.policyTitle", { title: policy.definition.title, version: policyVersionLabel(policy) }), ...policyLines(policy)] : [tr("reply.pay.noPolicy")]),
        ],
        links: policy ? [{ label: tr("reply.wf.viewPolicy"), href: `/rules/${policy.id}` }] : [],
        note: tr("reply.pay.demoNote"),
      });
    }
    if (need === "days") {
      if (d.requestedDate) {
        const diff = daysBetween(inv.due_date, d.requestedDate);
        d.requestedDate = null;
        if (diff >= 1 && diff <= 120) {
          d.extensionDays = diff;
          ctx.steps.push({ label: tr("reply.pay.dateAfter", { count: diff }), state: "done" });
          continue;
        }
        notice(ctx, "warning", tr("reply.pay.dateNotAfter"));
      }
      say(ctx, tr("reply.pay.daysQ"));
      options(ctx, env.runId, tr("reply.pay.extraDays"), [7, 14, 30].map((n) => ({ label: tr("reply.pay.daysOption", { count: n }), value: `days:${n}` })));
      return ask("days");
    }
    if (need === "complaint" || need === "welfare") {
      say(ctx, need === "complaint" ? COMPLAINT_Q() : WELFARE_Q());
      options(ctx, env.runId, tr(need === "complaint" ? "reply.wf.complaint" : "reply.wf.welfare"), TRI_OPTIONS(need));
      return ask(need);
    }

    const days = d.extensionDays!;
    const newDue = revisedDueDate(inv.due_date, days);
    const reminders = reminderSchedule(newDue, today);
    // Saved in notes to the owner and on the request, so in English.
    const summary = `give ${inv.invoice_ref} (${formatAud(inv.amount_cents)}) ${days} extra days, from ${formatDay(inv.due_date, "en-AU")} to ${formatDay(newDue, "en-AU")}`;
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
          tr("reply.pay.revised", { date: formatDay(newDue), count: days, from: formatDay(inv.due_date!) }),
          tr("reply.pay.schedule", { list: reminderList(reminders) }),
          tr("reply.pay.notSent"),
        ],
        links: [],
        note: tr("reply.pay.prepared"),
      }),
      verify: async (r) => {
        const now = await invoiceById(inv.id);
        const list = await scheduledReminders(inv.id);
        const before = (r?.before ?? {}) as { dueDate?: string; status?: string };
        const expected = String((r?.after as { dueDate?: string } | undefined)?.dueDate ?? newDue);
        if (!now || now.due_date !== expected) {
          notice(ctx, "error", tr("reply.pay.readBackFailed"));
          return "The invoice did not read back as expected.";
        }
        ctx.blocks.push({
          kind: "result",
          title: tr("reply.wf.checkedTitle"),
          rows: [
            { label: tr("reply.pay.rowDue"), before: before.dueDate ? formatDay(before.dueDate) : formatDay(inv.original_due_date ?? inv.due_date!), after: formatDay(now.due_date) },
            { label: tr("reply.pay.rowStatus"), before: cap(invoiceStatus(before.status ?? inv.status)), after: cap(invoiceStatus(now.status)) },
            { label: tr("reply.pay.rowReminders"), before: tr("reply.pay.earlier"), after: reminderList(list.map((x) => ({ date: x.remind_on, kind: x.kind }))) || tr("reply.wf.none") },
          ],
          notes: [tr("reply.wf.readBackNote", { id: inv.id }), tr("reply.pay.nothingSent")],
          verifiedAt: new Date().toISOString(),
        });
        simulated(ctx, tr("reply.pay.msgConfirmTitle"), inv.bookings?.families?.parent_name ?? tr("reply.wf.theFamily"),
          `Hello,\n\nWe've moved the due date for invoice ${inv.invoice_ref} (${formatAud(inv.amount_cents)}) to ${formatDay(now.due_date, "en-AU")}.\n\nKind regards`);
        return `${inv.invoice_ref} now due ${formatDay(now.due_date, "en-AU")}, ${list.length} reminders scheduled`;
      },
    });
  }
  return ask("reference");
}

/** Invoice statuses are words like "pending" and "overdue"; known ones are translated. */
function invoiceStatus(status: string): string {
  return ["pending", "overdue", "paid", "cancelled", "refunded"].includes(status) ? tr(`reply.pay.status.${status as "pending"}`) : cap(status);
}

// ---------------------------------------------------------------------------
// Tutor Absence

function coverLabel(o: AbsenceData["items"][number]["option"], names: Map<string, string>, slotTimes: Map<string, string>, absentName: string): string {
  if (!o) return tr("reply.abs.noChoice");
  if (o.kind === "skip") return tr("reply.abs.leftAsIs");
  if (o.kind === "cover") return tr("reply.abs.coverBy", { tutor: names.get(o.tutorId) ?? o.tutorId });
  return tr("reply.abs.moveTo", { time: slotTimes.get(o.slotId) ?? o.slotId, tutor: absentName });
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
        say(ctx, tr("reply.opening.tutor_absence"));
        return ask("tutor");
      }
      const id = /\bT-?(\d{2,6})\b/i.exec(hint);
      const lower = hint.toLowerCase();
      const matches = id
        ? tutors.filter((t) => t.id === `T-${id[1]}`)
        : tutors.filter((t) => lower.includes(t.name.toLowerCase()) || new RegExp(`\\b${t.name.split(" ")[0].toLowerCase()}\\b`).test(lower));
      ctx.steps.push({ label: tr("reply.abs.matching"), state: matches.length === 1 ? "done" : "blocked" });
      if (matches.length === 1) {
        d.tutorId = matches[0].id;
        d.tutorHint = matches[0].name;
        continue;
      }
      d.tutorHint = "";
      say(ctx, tr(matches.length ? "reply.abs.manyTutors" : "reply.abs.noTutor"));
      options(ctx, env.runId, tr("reply.abs.chooseTutor"), (matches.length ? matches : tutors).map((t) => ({ label: `${t.name} (${t.id})`, value: `tutor:${t.id}` })));
      return ask("tutor");
    }
    const tutorName = names.get(d.tutorId) ?? d.tutorId;
    if (need === "period") {
      say(ctx, tr("reply.abs.whenQ", { tutor: tutorName }));
      return ask("period");
    }
    if (d.endsOn < today || daysBetween(d.startsOn, d.endsOn) > 60) {
      say(ctx, d.endsOn < today ? tr("reply.abs.passed", { range: formatRange(d.startsOn, d.endsOn), tutor: tutorName }) : tr("reply.abs.tooLong"));
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
      const range = formatRange(d.startsOn, d.endsOn);
      ctx.steps.push({ label: tr("reply.abs.findingLessons", { tutor: tutorName, range }), state: "done" });
      ctx.blocks.push({
        kind: "found",
        items: affected.length
          ? [tr("reply.abs.affected", { tutor: tutorName, range, count: affected.length }), ...affected.map((l) => `${lessonLine(l)} (${l.id}).`)]
          : [tr("reply.abs.noLessons", { tutor: tutorName, range })],
        links: [],
        note: tr("reply.wf.demoData"),
      });
      continue;
    }
    if (need === "complaint" || need === "welfare") {
      say(ctx, tr(need === "complaint" ? "reply.abs.complaintQ" : "reply.abs.welfareQ"));
      options(ctx, env.runId, tr(need === "complaint" ? "reply.wf.complaint" : "reply.wf.welfare"), TRI_OPTIONS(need));
      return ask(need);
    }
    if (need === "option") {
      const i = d.items.findIndex((x) => !x.option);
      const lesson = await lessonById(d.items[i].lessonId);
      if (!lesson || lesson.status !== "scheduled") {
        d.items[i] = { ...d.items[i], option: { kind: "skip" } };
        notice(ctx, "info", tr("reply.abs.leftOut", { lesson: d.items[i].lessonId }));
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
      ctx.steps.push({ label: tr("reply.abs.checkingCover", { tutor: tutorName, lesson: lesson.id }), state: covers.length || moves.length ? "done" : "blocked" });
      const position = tr("reply.abs.position", { n: i + 1, total: d.items.length });
      say(ctx, [
        `${position}: ${lessonLine(lesson)}.`,
        tr(covers.length ? "reply.abs.coverNeedsOwner" : "reply.abs.noCover"),
        tr(moves.length ? "reply.abs.moveFollowsRules" : "reply.abs.noLaterTime", { tutor: tutorName }),
        tr("reply.abs.whatShouldHappen"),
      ].join(" "));
      options(ctx, env.runId, position, [
        ...covers.map((c) => ({ label: tr("reply.abs.coverOption", { tutor: c.tutor.name }), value: `option:cover:${c.tutor.id}:${c.slot.id}` })),
        ...moves.map((s) => ({ label: tr("reply.abs.moveOption", { time: formatSlot(s.startsAt) }), value: `option:move:${s.id}` })),
        { label: tr("reply.abs.leaveOption"), value: "option:skip" },
      ]);
      return ask("option");
    }
    if (need === "agreement") {
      const i = d.items.findIndex((x) => needsAgreement(x));
      const item = d.items[i];
      const kind = needsAgreement(item)!;
      const lesson = await lessonById(item.lessonId);
      const slot = item.option && item.option.kind !== "skip" ? await slotById(item.option.slotId) : null;
      const studentEn = lesson?.bookings?.families?.student_name ?? "the student";
      const student = lesson?.bookings?.families?.student_name ?? tr("reply.wf.theStudent");
      const coverName = item.option?.kind === "cover" ? names.get(item.option.tutorId) ?? item.option.tutorId : "";
      const when = (intl?: string) => (lesson ? formatSlot(lesson.starts_at, intl) : "");
      const to = (intl?: string) => (slot ? formatSlot(slot.startsAt, intl) : "");
      if (env.later === kind) {
        // Messages to families and tutors are drafted in English.
        const changeEn = item.option?.kind === "cover"
          ? `${coverName} covering ${studentEn}'s lesson on ${when("en-AU")}`
          : `moving ${studentEn}'s lesson from ${when("en-AU")} to ${to("en-AU")} with ${tutorName}`;
        if (kind === "family") {
          simulated(ctx, tr("reply.abs.msgFamilyTitle"), lesson?.bookings?.families?.parent_name ?? tr("reply.wf.theFamily"),
            `Hello,\n\n${tutorName} is unavailable ${formatRange(d.startsOn, d.endsOn, "en-AU")}. We'd like to arrange ${changeEn}. Please let us know if that suits. Nothing changes until you reply.\n\nKind regards`);
        } else {
          simulated(ctx, tr("reply.abs.msgTutorTitle"), coverName || tr("reply.abs.theTutor"),
            `Hello,\n\nCould you cover ${studentEn}'s ${lesson?.bookings?.subject ?? ""} lesson on ${when("en-AU")} while ${tutorName} is away? Nothing is booked until you confirm.\n\nThanks`);
        }
        say(ctx, tr("reply.abs.comeBack"));
        options(ctx, env.runId, tr("reply.abs.agreement"), kind === "family"
          ? [{ label: tr("reply.abs.familyAgreed"), value: "family:yes" }]
          : [{ label: tr("reply.abs.tutorAgreed"), value: "tutorok:yes" }]);
        return waiting(kind === "family" ? "waiting_family" : "waiting_tutor", "agreement");
      }
      const change = item.option?.kind === "cover"
        ? tr("reply.abs.changeCover", { tutor: coverName, student, time: when() })
        : tr("reply.abs.changeMove", { student, from: when(), to: to(), tutor: tutorName });
      say(ctx, kind === "family" ? tr("reply.abs.familyQ", { change }) : tr("reply.abs.tutorQ", { tutor: coverName, student, time: when() }));
      options(ctx, env.runId, tr("reply.abs.agreement"), kind === "family"
        ? [{ label: tr("reply.abs.familyAgreed"), value: "family:yes" }, { label: tr("reply.abs.notYet"), value: "family:later" }]
        : [{ label: tr("reply.abs.tutorAgreed"), value: "tutorok:yes" }, { label: tr("reply.abs.notYet"), value: "tutorok:later" }]);
      return ask("agreement");
    }
    if (need === "record") {
      if (d.absenceProposalId) {
        const o = await followProposal(d.absenceProposalId, ctx.user.id);
        if (o?.status === "pending") {
          say(ctx, tr("reply.abs.stillWaiting"));
          try {
            ctx.blocks.push({ kind: "proposal", proposal: await proposalView(ctx.user, o.id), intro: null, next: { label: tr("reply.common.continue"), command: continueCommand(env.runId) } });
          } catch { /* ignore */ }
          return confirmOut();
        }
        d.absenceProposalId = null;
        if (o?.status === "succeeded" && typeof o.result?.absenceId === "string") {
          d.absenceId = o.result.absenceId;
          ctx.steps.push({ label: tr("reply.abs.recorded", { tutor: tutorName }), state: "done" });
          continue;
        }
        if (o?.status === "failed") notice(ctx, "error", tr("reply.abs.recordFailed", { why: String(o.result?.error ?? "").replace(/^[a-z_]+:\s*/, "") }));
      }
      const p = { requestId: null, pendingProposalId: null as string | null, pendingAction: null, applied: false, stopped: false, verified: null, failure: null };
      const out = await prepareAndShow(env, p as Pipeline, { action: "tutor.record_absence", inputs: { tutorId: d.tutorId, startsOn: d.startsOn, endsOn: d.endsOn, note: d.context.slice(0, 500) } },
        tr(d.items.length ? "reply.abs.recordNext" : "reply.abs.recordOnly"));
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
        notice(ctx, "info", tr("reply.abs.noLongerScheduled", { lesson: item.lessonId }));
        continue;
      }
      const slot = await slotById(opt.slotId);
      const studentEn = lesson.bookings?.families?.student_name ?? "the student";
      const coverName = opt.kind === "cover" ? names.get(opt.tutorId) ?? opt.tutorId : "";
      // descEn is saved with the request and in notes to the owner; desc is what the reader sees.
      const descEn = opt.kind === "cover"
        ? `${coverName} covers ${studentEn}'s lesson ${lesson.id} on ${formatSlot(lesson.starts_at, "en-AU")} while ${tutorName} is away`
        : `move ${studentEn}'s lesson ${lesson.id} from ${formatSlot(lesson.starts_at, "en-AU")} to ${slot ? formatSlot(slot.startsAt, "en-AU") : opt.slotId} with ${tutorName}`;
      const student = lesson.bookings?.families?.student_name ?? tr("reply.wf.theStudent");
      const desc = opt.kind === "cover"
        ? tr("reply.abs.descCover", { tutor: coverName, student, lesson: lesson.id, time: formatSlot(lesson.starts_at), absent: tutorName })
        : tr("reply.abs.descMove", { student, lesson: lesson.id, from: formatSlot(lesson.starts_at), to: slot ? formatSlot(slot.startsAt) : opt.slotId, tutor: tutorName });
      if (!item.pipeline.requestId && !item.pipeline.pendingProposalId) say(ctx, `${tr("reply.abs.position", { n: i + 1, total: d.items.length })}: ${desc}.`);
      const out = await pipeline(env, item.pipeline, {
        workflow: "tutor_absence",
        summary: descEn,
        form: {
          requestType: "lesson_change", referenceId: item.bookingId, bookingId: item.bookingId, proposedSlotId: opt.slotId,
          financialImpact: "no", complaint: d.complaint, welfare: d.welfare,
          context: `Tutor absence: ${tutorName} is unavailable ${formatRange(d.startsOn, d.endsOn, "en-AU")}. Plan: ${descEn}.`,
        },
        applyInputs: {
          lessonId: lesson.id, newSlotId: opt.slotId,
          agreement: `The family agreed${opt.kind === "cover" ? ` and ${coverName} agreed to cover` : ""}, as confirmed by ${ctx.user.displayName} in Compass.`,
        },
        verify: (r) => verifyLesson(ctx, lesson.id, r, false),
      });
      if (out.status === "completed") continue;
      return out;
    }
    // done
    const slotTimes = new Map<string, string>();
    for (const it of d.items) if (it.option && it.option.kind !== "skip") { const s = await slotById(it.option.slotId); if (s) slotTimes.set(s.id, formatSlot(s.startsAt)); }
    const lines = d.items.map((it) => `${it.lessonId}: ${it.pipeline.applied ? tr("reply.abs.doneLine", { change: coverLabel(it.option, names, slotTimes, tutorName) }) : it.option?.kind === "skip" ? tr("reply.abs.skippedLine", { tutor: tutorName }) : tr("reply.abs.notChangedLine")}`);
    ctx.blocks.push({ kind: "found", items: [tr("reply.abs.absenceRecorded", { tutor: tutorName, range: formatRange(d.startsOn, d.endsOn) }), ...lines], links: [], note: tr("reply.abs.nothingSent") });
    say(ctx, tr(d.items.some((it) => it.option?.kind === "skip" || it.pipeline.stopped) ? "reply.abs.someLeft" : "reply.abs.allDone"));
    return { awaiting: null, status: "completed", stage: "done", mood: "success" };
  }
  return ask("tutor");
}
