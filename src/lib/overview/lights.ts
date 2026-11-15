import type { Colour, RequestStatus, Role } from "@/lib/domain/types";
import { workflowFor } from "@/lib/workflow/next-step";

// The Overview's three traffic-light cards. The colour is the rule result saved with each
// request (the rule engine decides it; nothing here changes it). The workflow status is
// separate: an approved request keeps its original colour, and it stays counted until its
// outcome is recorded and the request is closed. Pure, so it can be tested without a database.

/** Red first, then yellow, then green. "amber" is the stored value; people see "Yellow". */
export const LIGHT_ORDER = ["red", "amber", "green"] as const satisfies readonly Colour[];

/** The word in the address bar and on screen for each colour. */
export const LIGHT_PARAM: Record<Colour, string> = { red: "red", amber: "yellow", green: "green" };
export const LIGHT_WORD: Record<Colour, string> = { red: "Red", amber: "Yellow", green: "Green" };

export function lightFromParam(value: string | undefined | null): Colour | null {
  const v = (value ?? "").toLowerCase();
  if (v === "red") return "red";
  if (v === "yellow" || v === "amber") return "amber";
  if (v === "green") return "green";
  return null;
}

export type LightRow = {
  decision: Colour;
  status: RequestStatus;
  missing: number;
  reviewStartedAt?: string | null;
  welfare?: boolean;
};

/** A current record: anything not yet closed. Closed requests keep their colour as history only. */
export function isCurrent(row: Pick<LightRow, "status">): boolean {
  return row.status !== "closed";
}

/** The signed-in person can take the next step themselves (an enabled main button). */
export function canActOn(row: LightRow, role: Role): boolean {
  const w = workflowFor({ role, status: row.status, missing: row.missing, reviewStartedAt: row.reviewStartedAt ?? null, colour: row.decision, welfare: row.welfare });
  return Boolean(w.primary && !w.primary.disabled);
}

export type LightSummary = {
  colour: Colour;
  word: string;
  title: string;
  text: string;
  count: number;
  /** Of those, how many the signed-in person can act on now. */
  yours: number;
};

/** What each colour means, worded for who is signed in. Matches the rule engine's definitions. */
export function lightCopy(colour: Colour, role: Role): { title: string; text: string } {
  const owner = role === "owner";
  switch (colour) {
    case "red":
      return {
        title: "Stop and Escalate",
        text: owner ? "Complaints, welfare concerns and serious exceptions. You review these yourself." : "Complaints, welfare concerns and serious exceptions. Send to the owner and take no action yet.",
      };
    case "amber":
      return {
        title: "Clarify or Approve",
        text: owner ? "Missing details come first. Exceptions to the rules need your approval." : "Complete any missing details. Exceptions to the rules need the owner's approval first.",
      };
    case "green":
      return {
        title: "Inside the Rules",
        text: "The rules allow the action. Follow the approved steps, then record the outcome. Nothing happens automatically.",
      };
  }
}

export function summariseLights(rows: LightRow[], role: Role): LightSummary[] {
  const current = rows.filter(isCurrent);
  return LIGHT_ORDER.map((colour) => {
    const mine = current.filter((r) => r.decision === colour);
    return {
      colour,
      word: LIGHT_WORD[colour],
      ...lightCopy(colour, role),
      count: mine.length,
      yours: mine.filter((r) => canActOn(r, role)).length,
    };
  });
}

/** The rows the request list shows for a colour filter: current records of that colour, or everything when no filter is set. */
export function filterByLight<T extends LightRow>(rows: T[], colour: Colour | null): T[] {
  return colour ? rows.filter((r) => isCurrent(r) && r.decision === colour) : rows;
}
