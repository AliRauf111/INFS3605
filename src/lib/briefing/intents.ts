// Recognises Weekly Owner Briefing questions typed into Compass, with plain patterns so it
// works without live AI. Explicit questions are matched anywhere; short follow-ups ("why?",
// "what should I do first?", "and the enquiries?") only right after a briefing answer.

export type BriefingIntentKind =
  | "prepare" | "last_week" | "problems" | "overdue" | "completed" | "compare"
  | "why" | "first" | "finance" | "comms" | "lessons";
export type BriefingIntent = { kind: BriefingIntentKind };

const EXTENSION = /\b(extension|extend|more time|extra time|pay later|payment plan)\b/i;

const RULES: Array<{ kind: BriefingIntentKind; test: RegExp }> = [
  { kind: "compare", test: /\b(compar\w*|versus|vs\.?)\b.{0,40}\b(last|previous|prior|the week before)\b|\bhow (is|was|has|have) (my|the|our) (tutoring )?business (been )?(doing|going|performing|performed|tracking)\b|\bweek[- ]on[- ]week\b/i },
  { kind: "completed", test: /\bwhat (has|have|did) compass (complete|do|done|finish|achieve|handle)\w*\b|\bcompass (completed|did|has done|finished)\b.{0,30}\b(this|last|past) week\b|\bwhat (got|was|has been) (done|completed|finished)\b.{0,30}\bweek\b/i },
  { kind: "last_week", test: /\bwhat (happened|went on|has happened)\b.{0,40}\b(last|this|past) week\b|\b(recap|summary|summarise|summarize) (of )?(my |the )?(last|this|past) week\b/i },
  { kind: "prepare", test: /\b(weekly|week'?s)\b.{0,30}\b(brief(ing)?|summary|report|update|overview)\b|\b(business|owner) (brief(ing)?|summary|report)\b/i },
  { kind: "problems", test: /\b(biggest|main|top|worst|key|largest|major)\b.{0,30}\b(problems?|issues?|risks?|bottlenecks?|concerns?)\b/i },
  { kind: "overdue", test: /\b(which|who|what|list|show|how many)\b.{0,40}\b(overdue|unpaid|outstanding|late)\b.{0,30}\b(payments?|invoices?|fees?|balances?|bills?)\b|\b(which|who)\b.{0,30}\b(parents?|families)\b.{0,30}\b(owe|haven'?t paid|not paid|behind on)\b/i },
];

const FOLLOW: Array<{ kind: BriefingIntentKind; test: RegExp }> = [
  { kind: "why", test: /\bwhy\b|\bexplain\b|\bhow do you know\b|\bevidence\b|\bwhere (is|does) that (come|from)\b/i },
  { kind: "first", test: /\b(do|start|tackle) first\b|\bwhere (do|should) i start\b|\bprioriti[sz]e\b|\bmost important\b|\bwhat should i do\b|\btell me more\b|\bmore detail/i },
  { kind: "finance", test: /\b(payments?|invoices?|money|finance|financial|xero|cash)\b/i },
  { kind: "comms", test: /\b(enquir\w*|inquir\w*|parents?|emails?|messages?|texts?|sms|gmail|replies)\b/i },
  { kind: "lessons", test: /\b(lessons?|tutors?|absen\w*|cover|schedule|timetable)\b/i },
  { kind: "completed", test: /\b(completed|done|finished)\b/i },
  { kind: "compare", test: /\b(compare\w*|last week|week before|better|worse|change\w*)\b/i },
];

export function detectBriefing(text: string): BriefingIntent | null {
  if (EXTENSION.test(text)) return null;
  for (const r of RULES) if (r.test.test(text)) return { kind: r.kind };
  return null;
}

/** A short follow-up to the last briefing answer. */
export function briefingFollowUp(text: string): BriefingIntent | null {
  if (text.length > 140 || EXTENSION.test(text)) return null;
  for (const r of FOLLOW) if (r.test.test(text)) return { kind: r.kind };
  return null;
}
