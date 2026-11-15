"use client";
import { useSyncExternalStore } from "react";
import { DEFAULT_PREFS, applyPrefs, readSavedPrefs, samePrefs, writeSavedPrefs, type DisplayPrefs } from "@/lib/a11y/prefs";

// Shared state for the Display and Accessibility drawer: whether it is open, the
// preferences being previewed and the ones saved. As in the Studio design, changes preview
// straight away, Save Preferences keeps them and closes the drawer, and closing without
// saving puts the saved ones back. The triggers, the drawer and the Focus View bar all
// read this one store.

export type A11yState = {
  open: boolean;
  prefs: DisplayPrefs;
  saved: DisplayPrefs;
  message: { text: string; tone: "ok" | "error" } | null;
  /** A short note shown after the drawer closes, such as "saved". */
  toast: string | null;
};

const SERVER: A11yState = { open: false, prefs: DEFAULT_PREFS, saved: DEFAULT_PREFS, message: null, toast: null };
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
  applyPrefs(document.documentElement, p, deviceDark());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const saved = readSavedPrefs();
  state = { ...state, prefs: saved, saved };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => apply(state.prefs));
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

export function setOpen(open: boolean): void {
  start();
  if (open === state.open) return;
  const h = document.documentElement;
  if (open) h.setAttribute("data-a11y-open", "");
  else h.removeAttribute("data-a11y-open");
  // Closing without saving goes back to the saved preferences.
  if (!open && !samePrefs(state.prefs, state.saved)) apply(state.saved);
  state = { ...state, open, prefs: open ? state.prefs : state.saved, message: null, toast: open ? null : state.toast };
  emit();
}

export function updatePrefs(patch: Partial<DisplayPrefs>): void {
  start();
  const prefs = { ...state.prefs, ...patch };
  apply(prefs);
  state = { ...state, prefs, message: null };
  emit();
}

/** Saves what is previewed and closes the drawer, or explains why it couldn't be saved. */
export function savePrefs(): void {
  const ok = writeSavedPrefs(state.prefs);
  if (!ok) {
    state = { ...state, message: { text: "Preferences could not be saved in this browser. You can keep previewing them while this panel is open.", tone: "error" } };
    emit();
    return;
  }
  state = { ...state, saved: state.prefs, toast: "Your display preferences have been saved." };
  setOpen(false);
}

export function resetPrefs(): void {
  const ok = writeSavedPrefs(null);
  updatePrefs(DEFAULT_PREFS);
  state = { ...state, saved: DEFAULT_PREFS, message: { text: ok ? "Default display preferences restored." : "Defaults restored for this visit.", tone: "ok" } };
  emit();
}

export function clearToast(): void {
  if (!state.toast) return;
  state = { ...state, toast: null };
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
