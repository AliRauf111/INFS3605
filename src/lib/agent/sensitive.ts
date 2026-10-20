import type { TriState } from "@/lib/domain/types";

// Deciding what may leave our server. A welfare narrative is never sent to the AI
// provider: not in Quick Capture, not in Compass and not in drafts. The check is plain
// pattern matching, so it works the same with or without live AI, and it errs on the
// side of caution. A message that trips it is still read, but by the keyword rules here
// on the server, and the case goes through the normal deterministic escalation.

const WELFARE_PATTERNS: RegExp[] = [
  /\bunsafe\b/i,
  /\b(scared|frightened|afraid|terrified)\b/i,
  /\bhurt(ing|s)?\b/i,
  /\bharm(ed|ing)?\b/i,
  /\bself[-\s]?harm/i,
  /\bsuicid/i,
  /\babus(e|ed|ive)\b/i,
  /\bbull(y|ied|ying)\b/i,
  /\b(neglect|groom(ed|ing)?)\b/i,
  /\b(touched|inappropriate(ly)? (touch|contact|messages?))\b/i,
  /\bwelfare\b/i,
  /\bwell-?being\b/i,
  /\bchild (safety|protection)\b/i,
  /\bsafeguard/i,
  /\bin danger\b/i,
  /\bcall(ed)? (000|the police)\b/i,
];

export type SensitiveCheck = { sensitive: boolean; reason: string | null };

/** Does this text look like it describes a risk to a child's safety or wellbeing? */
export function screenSensitive(text: string): SensitiveCheck {
  const hit = WELFARE_PATTERNS.find((p) => p.test(text));
  return hit
    ? { sensitive: true, reason: "The text may describe a child welfare concern." }
    : { sensitive: false, reason: null };
}

/**
 * May content about this request go to the AI provider? Never for a welfare "yes" or
 * "not sure", and never when the recorded text itself looks like a welfare concern.
 */
export function aiAllowedFor(opts: { welfare: TriState | null; texts?: string[] }): boolean {
  if (opts.welfare === "yes" || opts.welfare === "unsure") return false;
  return !(opts.texts ?? []).some((t) => screenSensitive(t).sensitive);
}

export const SENSITIVE_NOTE =
  "This may describe a child welfare concern, so it was not sent to the AI service. Compass used the deterministic rules on our server instead.";
