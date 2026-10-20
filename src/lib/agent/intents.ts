// Working out what the person is asking Compass to do, for the owner and enquiry tools.
// Plain patterns cover the common phrasings so the tools work without live AI. When
// live AI is on, the model can also name one of these intents, but it never chooses a
// record, a rule or an outcome.

export const AGENT_INTENTS = [
  "briefing",
  "owner_queue",
  "pending_outcomes",
  "review",
  "explain",
  "decide",
  "requirements",
  "policy_overview",
  "followup",
] as const;
export type AgentIntent = (typeof AGENT_INTENTS)[number];

export type Decision = "approve" | "decline" | "request_info";

export type DetectedIntent = { intent: AgentIntent; decision?: Decision } | null;

const RULES: Array<{ intent: AgentIntent; test: RegExp; decision?: Decision }> = [
  { intent: "briefing", test: /\b(what needs (my )?attention|brief(ing)?|catch me up|what(?:'s| is) (outstanding|waiting|unfinished)|anything (urgent|waiting))\b/i },
  { intent: "pending_outcomes", test: /\b(pending outcomes?|awaiting (an? )?outcome|outcomes? (to record|not recorded)|not (yet )?recorded)\b/i },
  { intent: "owner_queue", test: /\b(need(s)? my (decision|approval)|waiting (for|on) (me|my decision|the owner)|awaiting (my|owner)|my queue|approval alley|requests? (for|to) (me to )?(decide|approve))\b/i },
  { intent: "explain", test: /\b(why (was|is|did) .{0,40}(escalat|red|amber|sent to (the )?owner)|explain (why|the (escalation|decision|result)))/i },
  { intent: "followup", test: /\b((prepare|draft|write) (a |the )?(reply|message|email|follow[- ]?up|response)|ask(ing)? (the family |them )?for (the )?(missing|more) (details|information|info))\b/i },
  { intent: "decide", decision: "request_info", test: /\b(ask (them |the admin )?for (more )?info(rmation)?|request (more )?info(rmation)?)\b/i },
  { intent: "decide", decision: "approve", test: /^\s*(please\s+)?approve\b|\bi(?:'d| would)? (want to |like to )?approve\b/i },
  { intent: "decide", decision: "decline", test: /^\s*(please\s+)?(decline|reject|refuse)\b|\bi(?:'d| would)? (want to |like to )?(decline|reject)\b/i },
  { intent: "review", test: /\b(prepare .{0,40}for (my )?review|review (this|that|the|request|refund|it|BK|FAM|PAY)|show me (this|that|the) request|open (this|that|the) request)\b/i },
  { intent: "requirements", test: /\b(what (info(rmation)?|details|facts) do (i|we) need|what do (i|we) need (to know )?(for|to))\b/i },
  { intent: "policy_overview", test: /\b(what can (i|we) do under|current (policy|rules)|what (are|do) the (rules|policies)( say)?|what am i allowed)\b/i },
];

export function detectIntent(text: string): DetectedIntent {
  for (const r of RULES) if (r.test.test(text)) return { intent: r.intent, ...(r.decision ? { decision: r.decision } : {}) };
  return null;
}

/** Does the message point at "this" request rather than naming one? */
export function refersToFocus(text: string): boolean {
  return /\b(this|that|it|the same|this one|that one)\b/i.test(text);
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, sixty: 60, ninety: 90, fortnight: 14, week: 7,
};

/** "seven extra days" becomes "7 extra days", and "a fortnight" or "a week" become days. */
export function numberWordsToDigits(text: string): string {
  return text
    .replace(/\b(a|one|an extra)\s+(fortnight|week)\b/gi, (_, __, w: string) => `${NUMBER_WORDS[w.toLowerCase()]} days`)
    .replace(/\b(two|three|four)\s+(?:more\s+|extra\s+|additional\s+)?weeks\b/gi, (_, n: string) => `${NUMBER_WORDS[n.toLowerCase()] * 7} days`)
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|sixty|ninety)\b(?=\s+(more\s+|extra\s+|additional\s+)?(days?|business days?))/gi, (w) => String(NUMBER_WORDS[w.toLowerCase()]));
}
