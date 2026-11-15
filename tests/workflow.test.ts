import { describe, expect, it } from "vitest";
import { allowedTransitions, countMissing, ownerCanReview, workflowFor, type WorkflowInput } from "@/lib/workflow/next-step";
import { availableActions, canPrepare } from "@/lib/agent/permissions";
import { COLOURS, type RequestStatus, type Role } from "@/lib/domain/types";

const wf = (role: Role, status: RequestStatus, missing = 0, extra: Partial<WorkflowInput> = {}) => workflowFor({ role, status, missing, ...extra });

describe("shared next step: missing details", () => {
  for (const role of ["admin", "owner"] as Role[]) {
    for (const status of ["needs_clarification", "review_required", "more_info_requested"] as RequestStatus[]) {
      it(`${role} on ${status} with missing details completes them first`, () => {
        const w = wf(role, status, 1, { colour: "amber" });
        expect(w.primary).toEqual({ kind: "complete_details", label: "Complete Missing Details", disabled: false });
        expect(w.queue).toBe("clarify");
        expect(w.can.sendToOwner).toBe(false);
        expect(w.can.approve).toBe(false);
        expect(w.can.completeDetails).toBe(true);
        expect(w.title).toBe("Complete Missing Details");
      });
    }
  }
  it("BK-1044: amber payment extension with complaint status unanswered", () => {
    for (const role of ["admin", "owner"] as Role[]) {
      const w = wf(role, "needs_clarification", 1, { colour: "amber" });
      expect(w.primary?.label).toBe("Complete Missing Details");
      expect(w.can.startReview).toBe(false);
      expect(allowedTransitions({ role, status: "needs_clarification", missing: 1 }).size).toBe(0);
    }
  });
  it("lets the owner start a review on review_required with missing details, but not approve", () => {
    const w = wf("owner", "review_required", 2, { colour: "red" });
    expect(w.primary?.kind).toBe("complete_details");
    expect(w.can.startReview).toBe(true);
    expect(w.can.approve).toBe(false);
    expect(w.can.decline).toBe(true);
    expect(w.approveBlocked).toMatch(/missing details/);
  });
  it("ignores missing policy and request type, which can't be filled in", () => {
    expect(countMissing([{ fact: "policy" }, { fact: "request_type" }])).toBe(0);
    expect(countMissing([{ fact: "complaint" }, { fact: "policy" }])).toBe(1);
    expect(countMissing(null)).toBe(0);
  });
});

describe("shared next step: details complete", () => {
  it("admin sends review_required to the owner", () => {
    const w = wf("admin", "review_required", 0, { colour: "red" });
    expect(w.primary?.label).toBe("Send to Owner");
    expect(w.queue).toBe("send");
    expect(w.can.approve).toBe(false);
  });
  it("owner never sees Send to Owner", () => {
    for (const status of ["needs_clarification", "review_required", "more_info_requested", "awaiting_owner", "ready", "approved", "declined", "closed"] as RequestStatus[]) {
      for (const missing of [0, 1]) {
        for (const colour of COLOURS) {
          const w = wf("owner", status, missing, { colour });
          expect(w.primary?.kind).not.toBe("send_to_owner");
          expect(w.can.sendToOwner).toBe(false);
          expect(w.title).not.toBe("Send to Owner");
          expect(w.pending).not.toMatch(/Send to Owner/);
          expect(availableActions("owner", status, missing)).not.toContain("request.send_to_owner");
        }
      }
    }
  });
  it("BK-1043: owner reviews a red welfare lesson change directly", () => {
    const before = wf("owner", "review_required", 0, { colour: "red", welfare: true });
    expect(before.title).toBe("Review and Handle");
    expect(before.queue).toBe("review");
    expect(before.primary).toEqual({ kind: "start_review", label: "Start Review", disabled: false });
    expect(before.can.handlingNote).toBe(true);
    const after = wf("owner", "review_required", 0, { colour: "red", welfare: true, reviewStartedAt: "2026-10-20T00:00:00Z" });
    expect(after.primary?.label).toBe("Continue Review");
    expect(after.reviewStarted).toBe(true);
    expect(after.can.approve && after.can.decline && after.can.requestInfo).toBe(true);
  });
  it("owner can review needs_clarification once the details are complete", () => {
    expect(ownerCanReview("needs_clarification", 0)).toBe(true);
    expect(ownerCanReview("needs_clarification", 1)).toBe(false);
    expect(wf("owner", "needs_clarification", 0).primary?.label).toBe("Start Review");
  });
  it("handling notes are for red or welfare requests only, never decided by colour alone for actions", () => {
    expect(wf("owner", "review_required", 0, { colour: "amber" }).can.handlingNote).toBe(false);
    expect(wf("owner", "review_required", 0, { colour: "amber" }).primary?.label).toBe("Start Review");
    expect(wf("owner", "review_required", 0, { colour: "red" }).primary?.label).toBe("Start Review");
    expect(wf("admin", "review_required", 0, { colour: "green" }).primary?.label).toBe("Send to Owner");
  });
});

describe("shared next step: awaiting, decided and closed", () => {
  it("admin waits once sent, with the button disabled", () => {
    const w = wf("admin", "awaiting_owner");
    expect(w.primary).toEqual({ kind: "awaiting_owner", label: "Awaiting Owner Decision", disabled: true });
    expect(w.queue).toBe("owner");
    expect(allowedTransitions({ role: "admin", status: "awaiting_owner", missing: 0 }).size).toBe(0);
  });
  it("owner reviews an awaiting request", () => {
    expect(wf("owner", "awaiting_owner").primary?.label).toBe("Start Review");
    expect(wf("owner", "awaiting_owner", 0, { reviewStartedAt: "x" }).primary?.label).toBe("Continue Review");
  });
  it("approved and declined requests are recorded by either role", () => {
    for (const role of ["admin", "owner"] as Role[]) {
      for (const status of ["approved", "declined", "ready"] as RequestStatus[]) {
        const w = wf(role, status);
        expect(w.primary?.label).toBe("Record Outcome");
        expect(w.queue).toBe("record");
        expect(w.can.startReview).toBe(false);
      }
    }
  });
  it("closed requests offer nothing", () => {
    for (const role of ["admin", "owner"] as Role[]) {
      const w = wf(role, "closed", 0, { reviewStartedAt: "x" });
      expect(w.primary).toBeNull();
      expect(w.pending).toBe("");
      expect(w.queue).toBe("done");
      expect(Object.values(w.can).some(Boolean)).toBe(false);
    }
  });
});

describe("Compass uses the same rules", () => {
  it("refuses Send to Owner for the owner and while details are missing", () => {
    expect(canPrepare("request.send_to_owner", "owner", "review_required").ok).toBe(false);
    expect(canPrepare("request.send_to_owner", "admin", "needs_clarification", 1).ok).toBe(false);
    expect(canPrepare("request.send_to_owner", "admin", "review_required", 0).ok).toBe(true);
  });
  it("lets the owner decide without the admin sending it, but not approve with missing details", () => {
    expect(availableActions("owner", "review_required")).toEqual(["request.approve", "request.decline", "request.request_info"]);
    expect(availableActions("owner", "review_required", 1)).toEqual(["request.decline", "request.request_info"]);
    expect(availableActions("owner", "needs_clarification", 1)).toEqual([]);
    expect(availableActions("admin", "review_required", 0)).toEqual(["request.send_to_owner"]);
    expect(availableActions("admin", "review_required", 1)).toEqual([]);
  });
});
