import { describe, expect, it } from "vitest";
import { demoResetEnabled, freshChat, isFullPageLoad, readCookie } from "@/lib/demo/mode";

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

describe("demo mode switch", () => {
  it("is on unless the deployment turns it off", () => {
    expect(demoResetEnabled(undefined)).toBe(true);
    expect(demoResetEnabled("")).toBe(true);
    expect(demoResetEnabled("on")).toBe(true);
    for (const off of ["off", "OFF", "false", "0", "no", " off "]) expect(demoResetEnabled(off)).toBe(false);
  });
});

describe("full page loads", () => {
  it("counts a refresh, a typed address or a sign-in redirect", () => {
    expect(isFullPageLoad("GET", headers({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "cache-control": "max-age=0" }))).toBe(true);
    expect(isFullPageLoad("GET", headers({ "sec-fetch-dest": "document" }))).toBe(true);
    // Older browsers without Sec-Fetch headers.
    expect(isFullPageLoad("GET", headers({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
  });

  it("never counts moving between pages, prefetches, server actions or API calls", () => {
    expect(isFullPageLoad("GET", headers({ rsc: "1", "sec-fetch-dest": "empty" }))).toBe(false);
    expect(isFullPageLoad("GET", headers({ rsc: "1", "next-router-prefetch": "1" }))).toBe(false);
    expect(isFullPageLoad("POST", headers({ "next-action": "abc", "sec-fetch-dest": "empty" }))).toBe(false);
    expect(isFullPageLoad("POST", headers({ "sec-fetch-dest": "document" }))).toBe(false);
    expect(isFullPageLoad("GET", headers({ "sec-fetch-dest": "empty", accept: "application/json" }))).toBe(false);
    expect(isFullPageLoad("GET", headers({ "sec-fetch-dest": "image", accept: "text/html" }))).toBe(false);
    expect(isFullPageLoad("GET", headers({ "sec-fetch-dest": "document", "sec-purpose": "prefetch;prerender" }))).toBe(false);
    expect(isFullPageLoad("GET", headers({ "sec-fetch-dest": "document", purpose: "prefetch" }))).toBe(false);
  });
});

describe("Compass chat after a reset", () => {
  it("starts fresh after a refresh or a new reset, and keeps the chat otherwise", () => {
    expect(freshChat({ reloaded: true, savedEpoch: "a", currentEpoch: "a" })).toBe(true);
    expect(freshChat({ reloaded: false, savedEpoch: "a", currentEpoch: "b" })).toBe(true);
    expect(freshChat({ reloaded: false, savedEpoch: undefined, currentEpoch: "b" })).toBe(true);
    expect(freshChat({ reloaded: false, savedEpoch: "a", currentEpoch: "a" })).toBe(false);
    // Demo mode off: no reset cookie, so only a refresh clears the chat, as before.
    expect(freshChat({ reloaded: false, savedEpoch: undefined, currentEpoch: null })).toBe(false);
  });

  it("reads the reset cookie without touching other cookies", () => {
    const c = "tc-display-prefs=x; tc_demo_epoch=2026-10-27T09%3A40%3A28.344Z; other=1";
    expect(readCookie(c, "tc_demo_epoch")).toBe("2026-10-27T09:40:28.344Z");
    expect(readCookie(c, "missing")).toBeNull();
    expect(readCookie("", "tc_demo_epoch")).toBeNull();
  });
});
