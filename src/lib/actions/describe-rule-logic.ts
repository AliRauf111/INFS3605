import { CATEGORY_CONFIG, type PolicyCategory, type PolicyDefinition, formatNumeric } from "@/lib/engine/policy";
import type { Colour } from "@/lib/domain/types";

// Simulated "Describe a rule": a small pattern reader used when no AI key is set.
// It is honest about what it guessed by listing every assumption as an ambiguity.

export function describeRuleSimulated(
  category: PolicyCategory,
  instruction: string,
): { definition: PolicyDefinition; ambiguities: string[] } {
  const config = CATEGORY_CONFIG[category];
  const lower = instruction.toLowerCase();
  const ambiguities: string[] = [
    "This proposal came from simple pattern matching, not AI. Check every rule before saving it.",
  ];
  const base = { permittedActions: [], nextSteps: [] as string[], escalation: "" };
  const green = { ...base, permittedActions: ["prepare_parent_response" as const, "prepare_admin_checklist" as const], nextSteps: ["Follow the approved procedure and record what you did."] };
  const escalate = { ...base, permittedActions: ["prepare_parent_response" as const, "prepare_escalation_summary" as const, "send_to_owner" as const] };

  if (!config.numeric) {
    ambiguities.push("The draft makes fee-free changes green and fee changes amber. The tutor must also be free at the new time.");
    return {
      ambiguities,
      definition: {
        category,
        title: "Lesson change rules (proposed)",
        requiredFacts: [...config.greenNeeds],
        rules: [
          { id: `${category}.rule_1`, label: "No fee change", range: null, financialImpact: "no", colour: "green", ...green },
          { id: `${category}.rule_2`, label: "Fee change", range: null, financialImpact: "yes", colour: "amber", ...escalate, escalation: "Owner approves fee changes." },
        ],
      },
    };
  }

  const isCents = config.numeric.unit === "cents";
  const pattern = isCents ? /\$\s?(\d+(?:\.\d{1,2})?)/g : /(\d{1,3})\s*days?/g;
  const values = [...new Set([...instruction.matchAll(pattern)].map((m) => (isCents ? Math.round(Number(m[1]) * 100) : Number(m[1]))))].sort((a, b) => a - b);
  if (values.length === 0) {
    ambiguities.push(`No ${isCents ? "dollar amounts" : "numbers of days"} were found, so the draft has a single amber rule. Add thresholds yourself.`);
  }
  // "up to $50" or "$50 or less" puts the boundary in the lower band.
  const inclusive = /(up to|or less|or under|inclusive|at most)/.test(lower);
  for (const v of values) {
    ambiguities.push(
      `Is exactly ${formatNumeric(category, v)} in the lower or upper band? The draft puts it in the ${inclusive ? "lower" : "upper"} band.`,
    );
  }
  const colours: Colour[] = values.length === 1 ? ["green", "red"] : ["green", "amber", "red"];
  if (values.length >= 1) ambiguities.push(`The draft assumes lower values are ${colours[0]} and higher values need more approval (${colours.join(", then ")}).`);
  if (values.length > 2) ambiguities.push("More than two thresholds were found. Only the first two were used.");

  const t = values.slice(0, 2);
  const bands: Array<{ min: number | null; max: number | null; maxInclusive: boolean; colour: Colour }> = [];
  if (t.length === 0) bands.push({ min: null, max: null, maxInclusive: true, colour: "amber" });
  else {
    let lower: number | null = null;
    t.forEach((threshold, i) => {
      bands.push({ min: lower, max: threshold, maxInclusive: inclusive, colour: colours[i] });
      lower = inclusive ? threshold + 1 : threshold;
    });
    bands.push({ min: lower, max: null, maxInclusive: true, colour: colours[t.length] });
  }

  return {
    ambiguities,
    definition: {
      category,
      title: `${config.label} rules (proposed)`,
      requiredFacts: [...config.greenNeeds],
      rules: bands.map((b, i) => ({
        id: `${category}.rule_${i + 1}`,
        label: `${b.colour[0].toUpperCase()}${b.colour.slice(1)} band`,
        range: { min: b.min, max: b.max, maxInclusive: b.maxInclusive },
        financialImpact: null,
        colour: b.colour,
        ...(b.colour === "green" ? green : { ...escalate, escalation: b.colour === "red" ? "Owner decides." : "Owner approves." }),
      })),
    },
  };
}
