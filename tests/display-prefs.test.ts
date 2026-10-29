import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  PREFS_SCRIPT,
  TEXT_SIZES,
  applyPrefs,
  prefsAttributes,
  resolveTheme,
  sanitizePrefs,
  stepTextSize,
  type DisplayPrefs,
} from "@/lib/a11y/prefs";

// A minimal <html> element: attributes and an inline font size are all the prefs touch.
class FakeRoot {
  attrs = new Map<string, string>();
  style = { fontSize: "" };
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  snapshot() { return { attrs: Object.fromEntries([...this.attrs].sort()), fontSize: this.style.fontSize }; }
}

/** Runs the inline <head> script against a fake document and storage. */
function runScript(stored: string | null, deviceDark = false) {
  const root = new FakeRoot();
  const fn = new Function("document", "localStorage", "window", "matchMedia", PREFS_SCRIPT);
  const mm = () => ({ matches: deviceDark });
  fn({ documentElement: root }, { getItem: (k: string) => (k === PREFS_KEY ? stored : null) }, { matchMedia: mm }, mm);
  return root.snapshot();
}

function applied(p: DisplayPrefs, deviceDark = false) {
  const root = new FakeRoot();
  applyPrefs(root as unknown as HTMLElement, p, deviceDark);
  return root.snapshot();
}

describe("display preferences", () => {
  it("falls back to the defaults for missing or broken values", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("nonsense")).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ textSize: 999, theme: "neon", focusView: "yes" })).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs({ textSize: 150, theme: "contrast", reduceMotion: true })).toEqual({ ...DEFAULT_PREFS, textSize: 150, theme: "contrast", reduceMotion: true });
  });

  it("steps text size through the fixed sizes and stops at each end", () => {
    expect(stepTextSize(100, -1)).toBe(100);
    expect(stepTextSize(100, 1)).toBe(110);
    expect(stepTextSize(175, 1)).toBe(200);
    expect(stepTextSize(200, 1)).toBe(200);
    expect(stepTextSize(133, 1)).toBe(100);
    expect(Math.max(...TEXT_SIZES)).toBeGreaterThanOrEqual(200);
  });

  it("resolves Follow Device from the device setting", () => {
    expect(resolveTheme("device", true)).toBe("dark");
    expect(resolveTheme("device", false)).toBe("light");
    expect(resolveTheme("contrast", true)).toBe("contrast");
  });

  it("writes only the attributes that are on", () => {
    expect(prefsAttributes(DEFAULT_PREFS, false)).toEqual({ "data-theme": "light", "data-focus": null, "data-motion": null, "data-controls": null, "data-text": null });
    const all = prefsAttributes({ focusView: true, reduceMotion: true, largerControls: true, textSize: 200, theme: "dark" }, false);
    expect(all).toEqual({ "data-theme": "dark", "data-focus": "on", "data-motion": "reduce", "data-controls": "large", "data-text": "200" });
  });

  it("leaves the browser's own text size alone at 100%", () => {
    expect(applied(DEFAULT_PREFS).fontSize).toBe("");
    expect(applied({ ...DEFAULT_PREFS, textSize: 125 }).fontSize).toBe("125%");
  });

  it("the head script gives the same result as the app for saved values", () => {
    const cases: [unknown, boolean][] = [
      [null, false],
      [null, true],
      [{ focusView: true, reduceMotion: true, largerControls: true, textSize: 200, theme: "contrast" }, false],
      [{ textSize: 110, theme: "device" }, true],
      [{ textSize: 120, theme: "purple", focusView: 1 }, false],
      ["not an object", false],
    ];
    for (const [saved, dark] of cases) {
      expect(runScript(saved === null ? null : JSON.stringify(saved), dark)).toEqual(applied(sanitizePrefs(saved), dark));
    }
    // Storage that isn't JSON is ignored rather than breaking the page.
    expect(() => runScript("{broken")).not.toThrow();
  });
});

