// Display and Accessibility preferences. Saved in this browser (localStorage), because
// Tutor Compass has no per-person settings table yet. They are written onto <html> as
// data attributes and a root font size, and the CSS does the rest:
//   data-theme="light|dark|contrast"   colours (Follow Device resolves to light or dark)
//   data-focus="on"                     Focus View hides secondary content
//   data-motion="reduce"                no movement or layout animation
//   data-controls="large"               bigger targets and spacing
//   style font-size: N%                 text size, relative to the browser's own default,
//                                       so browser zoom and its text settings still apply

export type ThemeChoice = "device" | "light" | "dark" | "contrast";
export type ResolvedTheme = "light" | "dark" | "contrast";

export type DisplayPrefs = {
  focusView: boolean;
  reduceMotion: boolean;
  largerControls: boolean;
  textSize: number;
  theme: ThemeChoice;
};

export const PREFS_KEY = "tc-display-prefs";
export const DEFAULT_PREFS: DisplayPrefs = { focusView: false, reduceMotion: false, largerControls: false, textSize: 100, theme: "device" };
export const TEXT_SIZES = [100, 110, 125, 150, 175, 200] as const;
export const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "device", label: "Follow Device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "contrast", label: "High Contrast" },
];

/** Anything read back from storage is checked; unknown or broken values fall back to the defaults. */
export function sanitizePrefs(raw: unknown): DisplayPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const size = typeof r.textSize === "number" && (TEXT_SIZES as readonly number[]).includes(r.textSize) ? r.textSize : DEFAULT_PREFS.textSize;
  const theme = THEMES.some((t) => t.value === r.theme) ? (r.theme as ThemeChoice) : DEFAULT_PREFS.theme;
  return {
    focusView: r.focusView === true,
    reduceMotion: r.reduceMotion === true,
    largerControls: r.largerControls === true,
    textSize: size,
    theme,
  };
}

export function samePrefs(a: DisplayPrefs, b: DisplayPrefs): boolean {
  return a.focusView === b.focusView && a.reduceMotion === b.reduceMotion && a.largerControls === b.largerControls && a.textSize === b.textSize && a.theme === b.theme;
}

/** The next text size up or down, or the same size at either end. */
export function stepTextSize(current: number, dir: 1 | -1): number {
  const i = (TEXT_SIZES as readonly number[]).indexOf(current);
  if (i === -1) return DEFAULT_PREFS.textSize;
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + dir))];
}

export function resolveTheme(choice: ThemeChoice, deviceDark: boolean): ResolvedTheme {
  return choice === "device" ? (deviceDark ? "dark" : "light") : choice;
}

/** The attributes for <html>. null means remove the attribute. */
export function prefsAttributes(p: DisplayPrefs, deviceDark: boolean): Record<string, string | null> {
  return {
    "data-theme": resolveTheme(p.theme, deviceDark),
    "data-focus": p.focusView ? "on" : null,
    "data-motion": p.reduceMotion ? "reduce" : null,
    "data-controls": p.largerControls ? "large" : null,
  };
}

export function applyPrefs(root: HTMLElement, p: DisplayPrefs, deviceDark: boolean): void {
  for (const [k, v] of Object.entries(prefsAttributes(p, deviceDark))) {
    if (v === null) root.removeAttribute(k);
    else root.setAttribute(k, v);
  }
  root.style.fontSize = p.textSize === 100 ? "" : `${p.textSize}%`;
}

export function readSavedPrefs(): DisplayPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writeSavedPrefs(p: DisplayPrefs | null): boolean {
  try {
    if (p === null || samePrefs(p, DEFAULT_PREFS)) localStorage.removeItem(PREFS_KEY);
    else localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs in <head> before the page paints, so saved colours, text size and layout settings
 * are there from the first frame. Kept small and self-contained; it repeats the checks in
 * sanitizePrefs (tests run the two side by side).
 */
export const PREFS_SCRIPT = `(function(){try{var h=document.documentElement,p=JSON.parse(localStorage.getItem(${JSON.stringify(PREFS_KEY)})||"null");if(!p||typeof p!=="object")p={};
var t=["device","light","dark","contrast"].indexOf(p.theme)>=0?p.theme:"device";
if(t==="device")t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
h.setAttribute("data-theme",t);
if(p.focusView===true)h.setAttribute("data-focus","on");
if(p.reduceMotion===true)h.setAttribute("data-motion","reduce");
if(p.largerControls===true)h.setAttribute("data-controls","large");
if(${JSON.stringify(TEXT_SIZES.filter((s) => s !== 100))}.indexOf(p.textSize)>=0)h.style.fontSize=p.textSize+"%";
}catch(e){}})();`;
