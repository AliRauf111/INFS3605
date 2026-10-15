import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_POLICIES, DEFAULT_REFUND_POLICY } from "@/lib/engine/default-policies";
import type { PolicyDefinition } from "@/lib/engine/policy";
import { validatePolicy } from "@/lib/engine/validate-policy";

const clone = (): PolicyDefinition => structuredClone(DEFAULT_REFUND_POLICY);

describe("policy validation before activation", () => {
  it.each(DEFAULT_POLICIES.map((p) => [p.category, p] as const))("the default %s policy passes", (_c, p) => {
    const r = validatePolicy(p);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("shows boundary cases at each threshold", () => {
    const r = validatePolicy(DEFAULT_REFUND_POLICY);
    const byLabel = Object.fromEntries(r.boundaryCases.map((c) => [c.label, c.colour]));
    expect(byLabel["$49.99"]).toBe("green");
    expect(byLabel["$50.00"]).toBe("amber");
    expect(byLabel["$200.00"]).toBe("amber");
    expect(byLabel["$200.01"]).toBe("red");
  });

  it("blocks overlapping rules", () => {
    const p = clone();
    p.rules[0].range = { min: null, max: 6000, maxInclusive: true };
    const r = validatePolicy(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /overlap/.test(i.message))).toBe(true);
  });

  it("warns about gaps, which fall to the default amber route", () => {
    const p = clone();
    p.rules[2].range = { min: 30000, max: null, maxInclusive: true };
    const r = validatePolicy(p);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.level === "warning" && /\$200\.01 to \$299\.99/.test(i.message))).toBe(true);
  });

  it("blocks a rule that can never match", () => {
    const p = clone();
    p.rules[1].range = { min: 25000, max: 5000, maxInclusive: true };
    expect(validatePolicy(p).ok).toBe(false);
  });

  it("blocks negative or fractional thresholds", () => {
    const p = clone();
    (p.rules[0].range as { max: number }).max = -1;
    expect(validatePolicy(p).ok).toBe(false);
    const q = clone();
    (q.rules[0].range as { max: number }).max = 49.5;
    expect(validatePolicy(q).ok).toBe(false);
  });

  it("blocks a green rule when safety checks are not required", () => {
    const p = clone();
    p.requiredFacts = ["amount", "reference", "payment_record"];
    const r = validatePolicy(p);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /Complaint status/.test(i.message))).toBe(true);
  });

  it("blocks duplicate rule IDs", () => {
    const p = clone();
    p.rules[1].id = p.rules[0].id;
    expect(validatePolicy(p).ok).toBe(false);
  });

  it("rejects fields the builder does not support", () => {
    expect(validatePolicy({ ...clone(), script: "drop table" }).ok).toBe(false);
  });
});

describe("seed data", () => {
  it("seeds the same policy definitions the code ships with", () => {
    const sql = readFileSync(path.join(__dirname, "..", "supabase", "seed.sql"), "utf8");
    for (const p of DEFAULT_POLICIES) {
      const marker = `-- policy:${p.category}`;
      const start = sql.indexOf(marker);
      expect(start, `seed.sql should contain ${marker}`).toBeGreaterThan(-1);
      const json = sql.slice(sql.indexOf("$json$", start) + 6, sql.indexOf("$json$", sql.indexOf("$json$", start) + 6));
      expect(JSON.parse(json)).toEqual(p);
    }
  });
});
