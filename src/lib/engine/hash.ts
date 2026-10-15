import { createHash } from "node:crypto";

/** JSON with object keys sorted, so the same data always produces the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * A fingerprint of everything the engine used. Two decisions with the same fingerprint
 * had identical inputs, so they must have identical results.
 */
export function hashDecisionInput(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
