// The rules card on the Overview. Pure, so it can be tested.

export type RuleLite = { colour?: string; range?: { max?: number | null } | null; label?: string };

export type PolicyLite = { category: string; definition: { rules?: RuleLite[] } | null };

/**
 * Short lines for "Your business, your rules", read from the owner's active rule sets: the
 * limit the team can handle without the owner, for payment extensions and refunds.
 */
export function ruleLines(policies: PolicyLite[]): string[] {
  const greenMax = (cat: string) => {
    const p = policies.find((x) => x.category === cat);
    const r = p?.definition?.rules?.find((x) => x.colour === "green" && typeof x.range?.max === "number");
    return r?.range?.max ?? null;
  };
  const out: string[] = [];
  const days = greenMax("payment_extension");
  if (days !== null) out.push(`Payment extensions up to ${days} days`);
  const cents = greenMax("refund");
  if (cents !== null) out.push(`Refunds under $${Math.round(cents / 100)} handled by the team`);
  if (policies.some((p) => p.category === "lesson_change")) out.push("Lesson changes checked against your rules");
  return out;
}
