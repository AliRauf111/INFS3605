import { describe, expect, it, vi } from "vitest";
import {
  COLUMN_GAP,
  FULL_WIDTH_BELOW,
  LAUNCHER,
  isNearBottom,
  lockPageScroll,
  makeSiblingsInert,
  scrollTargetForNew,
  stopMedia,
  workspaceGeometry,
} from "@/lib/assistant/workspace";

describe("workspace geometry", () => {
  const column = LAUNCHER.right + LAUNCHER.size + COLUMN_GAP;

  it("covers almost the whole desktop viewport and ends just before the launcher column", () => {
    const g = workspaceGeometry({ width: 1440, height: 900, offsetTop: 0 });
    expect(g.mode).toBe("column");
    expect(g.left).toBe(g.margin);
    expect(g.top).toBe(g.margin);
    expect(g.left + g.width).toBe(1440 - column);
    expect(g.top + g.height).toBe(900 - g.margin);
    // The launcher (right 24px, 76px wide) sits wholly inside the clear column.
    expect(1440 - LAUNCHER.right - LAUNCHER.size).toBeGreaterThan(g.left + g.width);
  });

  it("keeps the same even margins and column on a tablet", () => {
    const g = workspaceGeometry({ width: 1024, height: 768, offsetTop: 0 });
    expect(g.mode).toBe("column");
    expect(g.margin).toBeGreaterThan(0);
    expect(g.left).toBe(g.margin);
    expect(768 - (g.top + g.height)).toBe(g.margin);
    expect(g.left + g.width).toBe(1024 - column);
  });

  it("uses the full visible screen on phones, above the on-screen keyboard", () => {
    const open = workspaceGeometry({ width: 390, height: 844, offsetTop: 0 });
    expect(open).toMatchObject({ mode: "full", left: 0, top: 0, width: 390, height: 844, column: 0 });
    const typing = workspaceGeometry({ width: 390, height: 500, offsetTop: 120 });
    expect(typing).toMatchObject({ mode: "full", top: 120, height: 500 });
    expect(workspaceGeometry({ width: FULL_WIDTH_BELOW - 1, height: 700, offsetTop: 0 }).mode).toBe("full");
    expect(workspaceGeometry({ width: FULL_WIDTH_BELOW, height: 700, offsetTop: 0 }).mode).toBe("column");
  });

  it("never returns negative sizes", () => {
    const g = workspaceGeometry({ width: 620, height: 20, offsetTop: -5 });
    expect(g.width).toBeGreaterThanOrEqual(0);
    expect(g.height).toBeGreaterThanOrEqual(0);
    expect(g.top).toBeGreaterThanOrEqual(0);
  });
});

describe("following new messages", () => {
  const list = { scrollHeight: 2000, clientHeight: 500 };
  it("scrolls to the end for a short reply", () => {
    expect(scrollTargetForNew(list, null)).toBe(1500);
  });
  it("stops at the top of a long reply so it reads from the start", () => {
    expect(scrollTargetForNew(list, 1100)).toBe(1088);
  });
  it("never scrolls past the end", () => {
    expect(scrollTargetForNew(list, 1900)).toBe(1500);
    expect(scrollTargetForNew({ scrollHeight: 300, clientHeight: 500 }, 10)).toBe(0);
  });
  it("only counts as at the bottom when close to it", () => {
    expect(isNearBottom({ scrollHeight: 2000, scrollTop: 1450, clientHeight: 500 })).toBe(true);
    expect(isNearBottom({ scrollHeight: 2000, scrollTop: 900, clientHeight: 500 })).toBe(false);
  });
});

function fakeDoc(clientWidth: number, initial: Record<string, string> = {}) {
  const props = new Map(Object.entries(initial));
  return {
    props,
    documentElement: {
      clientWidth,
      style: {
        getPropertyValue: (p: string) => props.get(p) ?? "",
        setProperty: (p: string, v: string) => void props.set(p, v),
        removeProperty: (p: string) => { const v = props.get(p) ?? ""; props.delete(p); return v; },
      },
    },
  };
}

describe("locking the page underneath", () => {
  it("stops scrolling and holds the scrollbar's space so nothing shifts", () => {
    const doc = fakeDoc(1425);
    const unlock = lockPageScroll(doc, 1440, true);
    expect(doc.props.get("overflow")).toBe("hidden");
    expect(doc.props.get("scrollbar-gutter")).toBe("stable");
    unlock();
    expect(doc.props.size).toBe(0);
  });

  it("pads instead where scrollbar-gutter isn't supported", () => {
    const doc = fakeDoc(1425);
    lockPageScroll(doc, 1440, false);
    expect(doc.props.get("padding-right")).toBe("15px");
  });

  it("adds nothing for the scrollbar when there isn't one", () => {
    const doc = fakeDoc(390);
    lockPageScroll(doc, 390, true);
    expect(doc.props.has("scrollbar-gutter")).toBe(false);
    expect(doc.props.has("padding-right")).toBe(false);
  });

  it("puts back exactly what was there before, once", () => {
    const doc = fakeDoc(1440, { overflow: "hidden" });
    const unlock = lockPageScroll(doc, 1440, true);
    unlock();
    expect(doc.props.get("overflow")).toBe("hidden");
    doc.props.set("overflow", "auto");
    unlock();
    expect(doc.props.get("overflow")).toBe("auto");
  });
});

describe("making the page inert", () => {
  const el = (tagName: string, inert = false) => ({ tagName, inert });

  it("makes every sibling inert except the Compass layer, and restores them", () => {
    const header = el("HEADER");
    const main = el("MAIN");
    const script = el("SCRIPT");
    const compass = el("DIV");
    const restore = makeSiblingsInert([header, main, script, compass], compass);
    expect([header.inert, main.inert, script.inert, compass.inert]).toEqual([true, true, false, false]);
    restore();
    expect([header.inert, main.inert]).toEqual([false, false]);
  });

  it("leaves something that was already inert as it was", () => {
    const already = el("ASIDE", true);
    const compass = el("DIV");
    const restore = makeSiblingsInert([already, compass], compass);
    restore();
    expect(already.inert).toBe(true);
  });

  it("covers elements added while open", () => {
    const compass = el("DIV");
    const restore = makeSiblingsInert([compass], compass);
    const toast = el("DIV");
    restore.add([toast]);
    expect(toast.inert).toBe(true);
    restore();
    expect(toast.inert).toBe(false);
  });
});

describe("closing", () => {
  it("stops the microphone and spoken playback", () => {
    const releaseMic = vi.fn();
    const stopSpeaking = vi.fn();
    stopMedia({ releaseMic, stopSpeaking });
    expect(releaseMic).toHaveBeenCalledOnce();
    expect(stopSpeaking).toHaveBeenCalledOnce();
  });
});
