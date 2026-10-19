"use client";
import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, applyPrefs, readSavedPrefs, samePrefs, writeSavedPrefs, type DisplayPrefs } from "@/lib/a11y/prefs";
import { animateLayout, finishLayoutMotion } from "./layout-motion";

// Shared state for the Display and Accessibility panel: whether it is open, how it is shown
// (beside the page or as a drawer over it), the preferences being previewed and the ones
// saved. The triggers, the panel and the Focus View bar all read this one store.

export type PanelMode = "side" | "modal";
export type A11yState = {
  open: boolean;
  mode: PanelMode;
  prefs: DisplayPrefs;
  saved: DisplayPrefs;
  message: { text: string; tone: "ok" | "error" } | null;
};

const SERVER: A11yState = { open: false, mode: "modal", prefs: DEFAULT_PREFS, saved: DEFAULT_PREFS, message: null };
let state: A11yState = SERVER;
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function deviceDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(p: DisplayPrefs) {
  const before = document.documentElement.getAttribute("data-motion");
  applyPrefs(document.documentElement, p, deviceDark());
  // Turning on Reduce Motion part-way through a transition settles it at once.
  if (before !== "reduce" && p.reduceMotion) finishLayoutMotion();
}

/** The panel sits beside the page only when the page keeps enough room for readable content. */
export function pickMode(width: number, textSize: number): PanelMode {
  return width - 392 >= 800 * Math.max(1, textSize / 100) ? "side" : "modal";
}

function setLayout(open: boolean, mode: PanelMode) {
  const h = document.documentElement;
  if (open) h.setAttribute("data-a11y-open", "");
  else h.removeAttribute("data-a11y-open");
  h.setAttribute("data-a11y-mode", mode);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const saved = readSavedPrefs();
  state = { ...state, prefs: saved, saved, mode: pickMode(window.innerWidth, saved.textSize) };
  setLayout(false, state.mode);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => apply(state.prefs));
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => { if (e.matches) finishLayoutMotion(); });
  // Another tab saved new preferences.
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== "tc-display-prefs") return;
    const next = readSavedPrefs();
    state = { ...state, prefs: next, saved: next };
    apply(next);
    emit();
  });
}

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useA11y(): A11yState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

export function getA11y(): A11yState {
  start();
  return state;
}

/** Re-checks the layout mode, for example after a resize, rotation or text size change. */
export function refreshMode(): void {
  const mode = pickMode(window.innerWidth, state.prefs.textSize);
  if (mode === state.mode) return;
  finishLayoutMotion();
  state = { ...state, mode };
  setLayout(state.open, mode);
  emit();
}

export function setOpen(open: boolean): void {
  start();
  if (open === state.open) return;
  const mode = pickMode(window.innerWidth, state.prefs.textSize);
  const change = () => setLayout(open, mode);
  // As a drawer over the page nothing underneath moves, so only the drawer animates.
  if (mode === "side" || state.mode === "side") animateLayout(change);
  else change();
  state = { ...state, open, mode, message: open ? state.message : null };
  emit();
}

export function updatePrefs(patch: Partial<DisplayPrefs>): void {
  start();
  const prefs = { ...state.prefs, ...patch };
  const mode = pickMode(window.innerWidth, prefs.textSize);
  const run = () => {
    apply(prefs);
    if (mode !== state.mode) setLayout(state.open, mode);
  };
  // A text size change can move the page between side panel and drawer; animate that too.
  if (state.open && mode !== state.mode) animateLayout(run);
  else run();
  state = { ...state, prefs, mode, message: null };
  emit();
}

export function savePrefs(): void {
  const ok = writeSavedPrefs(state.prefs);
  state = {
    ...state,
    saved: ok ? state.prefs : state.saved,
    message: ok
      ? { text: "Preferences saved. They'll apply each time you use Tutor Compass in this browser.", tone: "ok" }
      : { text: "Your browser blocked saving. The changes stay for now but won't be kept after a reload.", tone: "error" },
  };
  emit();
}

export function resetPrefs(): void {
  writeSavedPrefs(null);
  updatePrefs(DEFAULT_PREFS);
  state = { ...state, saved: DEFAULT_PREFS, message: { text: "Preferences reset to the defaults.", tone: "ok" } };
  emit();
}

/** Turns one setting off and keeps that saved, for the Focus View bar's way back. */
export function saveOne(patch: Partial<DisplayPrefs>): void {
  updatePrefs(patch);
  const saved = { ...state.saved, ...patch };
  writeSavedPrefs(saved);
  state = { ...state, saved };
  emit();
}

export function hasUnsaved(s: A11yState): boolean {
  return !samePrefs(s.prefs, s.saved);
}
