// Money is always handled as whole cents (integers). Floating point numbers can turn
// 0.1 + 0.2 into 0.30000000000000004, which is not acceptable for refund limits.

export const MAX_AMOUNT_CENTS = 10_000_000; // $100,000. Anything above this is almost certainly a typo.

export type AmountParse =
  | { ok: true; cents: number | null }
  | { ok: false; error: string };

/**
 * Turn what a person typed ("49.99", "$1,200", "75") into cents.
 * Blank input means "not provided" (null), which is different from zero.
 */
export function parseAmountToCents(input: string | null | undefined): AmountParse {
  if (input === null || input === undefined) return { ok: true, cents: null };
  const raw = String(input).trim();
  if (raw === "") return { ok: true, cents: null };
  if (raw.startsWith("-") || raw.includes("-")) {
    return { ok: false, error: "Amounts cannot be negative." };
  }
  const cleaned = raw.replace(/^\$/, "").replace(/^AUD\s*/i, "");
  // Optional thousands separators, then up to two decimal places.
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    return { ok: false, error: "Enter an amount in dollars and cents, for example 49.99." };
  }
  const dollars = Number(match[1].replace(/,/g, ""));
  const centsPart = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  const cents = dollars * 100 + centsPart;
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) {
    return { ok: false, error: "That amount is too large for this alpha (limit $100,000)." };
  }
  return { ok: true, cents };
}

const audFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  minimumFractionDigits: 2,
});

export function formatAud(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "Not provided";
  return audFormatter.format(cents / 100);
}

/** For form fields: 4999 becomes "49.99". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}
