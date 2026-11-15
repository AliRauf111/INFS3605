import { removalNeedsOwner } from "@/lib/domain/progress";
import type { RequestStatus, Role } from "@/lib/domain/types";

// What archiving, removing and putting back do to one request. These only change where a
// request is listed. They never touch its decision, status, money or history, and they
// never approve anything.

export const LIST_ACTIONS = ["archive", "unarchive", "remove", "restore"] as const;
export type ListAction = (typeof LIST_ACTIONS)[number];

export type ListState = {
  status: RequestStatus;
  welfare_status: string | null;
  hidden_at: string | null;
  archived_at: string | null;
};

export type ListPlan =
  | { kind: "skip" } // already in the asked-for state, so nothing to do
  | { kind: "refuse"; reason: string }
  | { kind: "update"; patch: Record<string, string | null>; event: "archived" | "unarchived" | "removed_from_list" | "restored_to_list" };

export const OWNER_ONLY_REASON = "Only the owner can do this to a request that is waiting for them or raises a welfare concern.";

export function planListAction(action: ListAction, current: ListState, role: Role, userId: string, now: string): ListPlan {
  const ownerOnly = role !== "owner" && removalNeedsOwner(current.status, current.welfare_status);
  switch (action) {
    case "archive":
      if (current.archived_at) return { kind: "skip" };
      if (current.hidden_at) return { kind: "refuse", reason: "It has been removed from the list. Put it back first." };
      if (ownerOnly) return { kind: "refuse", reason: OWNER_ONLY_REASON };
      return { kind: "update", patch: { archived_at: now, archived_by: userId }, event: "archived" };
    case "unarchive":
      if (!current.archived_at) return { kind: "skip" };
      return { kind: "update", patch: { archived_at: null, archived_by: null }, event: "unarchived" };
    case "remove":
      if (current.hidden_at) return { kind: "skip" };
      if (ownerOnly) return { kind: "refuse", reason: OWNER_ONLY_REASON };
      return { kind: "update", patch: { hidden_at: now, hidden_by: userId }, event: "removed_from_list" };
    case "restore":
      if (!current.hidden_at) return { kind: "skip" };
      return { kind: "update", patch: { hidden_at: null, hidden_by: null }, event: "restored_to_list" };
  }
}
