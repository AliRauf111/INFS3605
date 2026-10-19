"use client";
import "./a11y.css";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { THEMES, TEXT_SIZES, stepTextSize, type DisplayPrefs } from "@/lib/a11y/prefs";
import { getA11y, hasUnsaved, refreshMode, resetPrefs, saveOne, savePrefs, setOpen, updatePrefs, useA11y } from "./store";

// The Display and Accessibility panel. On wide screens it sits beside the page and the page
// makes room for it (a non-modal dialog, so the dashboard stays usable). On smaller screens it
// is a drawer over the page with the background made inert until it closes.

let lastTrigger: HTMLElement | null = null;

function toggleFrom(el: HTMLElement) {
  const open = !getA11y().open;
  if (open) lastTrigger = el;
  setOpen(open);
}

function AccessIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="6.9" r="1.55" fill="currentColor" />
      <path d="M7 9.6l5 1.1 5-1.1M12 10.7v3.2l-2.4 4.4M12 13.9l2.4 4.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The Accessibility button. Each page has one, in its page header's action area (see PageHeader). */
export function A11yTrigger() {
  const s = useA11y();
  return (
    <button
      type="button"
      className="btn secondary a11y-trigger"
      aria-expanded={s.open}
      aria-controls="a11y-panel"
      data-a11y-trigger=""
      onClick={(e) => toggleFrom(e.currentTarget)}
    >
      <AccessIcon /> <span className="a11y-trigger-text">Accessibility</span>
    </button>
  );
}

/** Shown at the top of every page while Focus View is on, with a clear way back. */
export function FocusViewBar() {
  return (
    <div className="focus-bar" role="region" aria-label="Focus View">
      <p>Focus View is on. Some extra detail is hidden.</p>
      <button type="button" className="btn secondary small" onClick={() => saveOne({ focusView: false })}>Show Full View</button>
    </div>
  );
}

function Switch({ id, label, desc, checked, onChange }: { id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="a11y-row">
      <label htmlFor={id} className="a11y-row-text">
        <span className="a11y-row-label">{label}</span>
        <span className="a11y-row-desc" id={`${id}-desc`}>{desc}</span>
      </label>
      <input id={id} type="checkbox" role="switch" className="a11y-switch" checked={checked} aria-describedby={`${id}-desc`} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

const BACKGROUND = [".skip-link", ".demo-strip", ".site-header", "#main", ".site-footer", ".compass-root"];

export function A11yPanel() {
  const s = useA11y();
  const uid = useId();
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pathname = usePathname();
  const modal = s.mode === "modal";
  const p = s.prefs;
  const set = (patch: Partial<DisplayPrefs>) => updatePrefs(patch);

  // Focus moves into the panel when it opens and back to the button that opened it on close.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (s.open && !wasOpen.current) {
      requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    } else if (!s.open && wasOpen.current) {
      const inside = panelRef.current?.contains(document.activeElement) || document.activeElement === document.body;
      if (inside) {
        const target = lastTrigger?.isConnected ? lastTrigger : document.querySelector<HTMLElement>("[data-a11y-trigger]");
        target?.focus({ preventScroll: true });
      }
    }
    wasOpen.current = s.open;
  }, [s.open]);

  // As a drawer, everything behind it is inert, so focus and screen readers stay in the panel.
  useEffect(() => {
    if (!(s.open && modal)) return;
    const els = BACKGROUND.flatMap((sel) => [...document.querySelectorAll<HTMLElement>(sel)]).filter((el) => !el.inert);
    els.forEach((el) => { el.inert = true; });
    return () => els.forEach((el) => { el.inert = false; });
  }, [s.open, modal]);

  // Escape closes it: always as a drawer, and beside the page when focus is in the panel or on its button.
  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const a = document.activeElement;
      if (modal || panelRef.current?.contains(a) || (a instanceof HTMLElement && a.dataset.a11yTrigger !== undefined)) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [s.open, modal]);

  // Resizing or rotating can move the panel between beside the page and drawer.
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refreshMode);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // The panel starts just below the sticky header, whatever its height.
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".site-header");
    if (!header) return;
    const set = () => document.documentElement.style.setProperty("--a11y-top", `${header.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  // A drawer closes when the page changes; beside the page it can stay open.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname && getA11y().open && getA11y().mode === "modal") setOpen(false);
    lastPath.current = pathname;
  }, [pathname]);

  // Keep Tab inside the drawer.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!modal || e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const minSize = p.textSize === TEXT_SIZES[0];
  const maxSize = p.textSize === TEXT_SIZES[TEXT_SIZES.length - 1];
  const unsaved = hasUnsaved(s);

  return (
    <>
      <div className="a11y-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
      <aside
        id="a11y-panel"
        ref={panelRef}
        className="a11y-panel"
        role="dialog"
        aria-modal={modal ? true : undefined}
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-help`}
        inert={!s.open}
        onKeyDown={onKeyDown}
      >
        <div className="a11y-head">
          <div>
            <h2 id={`${uid}-title`} ref={titleRef} tabIndex={-1}>Display and Accessibility</h2>
            <p id={`${uid}-help`}>Make TutorCompass work for you.</p>
          </div>
          <button type="button" className="a11y-close" onClick={() => setOpen(false)} aria-label="Close Display and Accessibility">
            <span aria-hidden="true">Close</span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="a11y-body">
          <section className="a11y-group" aria-labelledby={`${uid}-focus`}>
            <h3 id={`${uid}-focus`}>Focus and Comfort</h3>
            <Switch id={`${uid}-fv`} label="Focus View" desc="Hide extra detail so the main tasks stand out. Warnings and actions stay." checked={p.focusView} onChange={(v) => set({ focusView: v })} />
            <Switch id={`${uid}-rm`} label="Reduce Motion" desc="Turn off animation and moving layout changes across the site." checked={p.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
            <Switch id={`${uid}-lc`} label="Larger Controls" desc="Use bigger buttons and form controls with more space around them." checked={p.largerControls} onChange={(v) => set({ largerControls: v })} />
          </section>

          <section className="a11y-group" aria-labelledby={`${uid}-reading`}>
            <h3 id={`${uid}-reading`}>Reading</h3>
            <div className="a11y-row">
              <span className="a11y-row-label" id={`${uid}-ts`}>Text Size</span>
              <div className="a11y-stepper" role="group" aria-labelledby={`${uid}-ts`}>
                <button type="button" onClick={() => set({ textSize: stepTextSize(p.textSize, -1) })} disabled={minSize} aria-label="Decrease text size">A−</button>
                <output aria-live="polite" aria-label={`Text size ${p.textSize}%`}>{p.textSize}%</output>
                <button type="button" onClick={() => set({ textSize: stepTextSize(p.textSize, 1) })} disabled={maxSize} aria-label="Increase text size">A+</button>
              </div>
            </div>
            <fieldset className="a11y-theme">
              <legend className="a11y-row-label">Colour Theme</legend>
              <div className="a11y-segments">
                {THEMES.map((t) => (
                  <label key={t.value} className="a11y-segment">
                    <input type="radio" name={`${uid}-theme`} value={t.value} checked={p.theme === t.value} onChange={() => set({ theme: t.value })} />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          <div className="a11y-actions">
            <button type="button" className="btn" onClick={savePrefs}>Save Preferences</button>
            <button type="button" className="btn secondary" onClick={resetPrefs}>Reset</button>
          </div>
          <p className={`a11y-status${s.message?.tone === "error" ? " error" : ""}`} role="status">
            {s.message ? s.message.text : unsaved ? "Changes show straight away. Save to keep them after a reload." : ""}
          </p>
          <p className="a11y-note">Saved in this browser on this device.</p>
        </div>
      </aside>
    </>
  );
}
