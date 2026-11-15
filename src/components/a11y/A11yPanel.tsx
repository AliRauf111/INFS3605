"use client";
import "./a11y.css";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef } from "react";
import { Icon } from "@/components/Icons";
import { THEMES, TEXT_SIZES, stepTextSize, type DisplayPrefs } from "@/lib/a11y/prefs";
import { clearToast, getA11y, resetPrefs, saveOne, savePrefs, setOpen, updatePrefs, useA11y } from "./store";

// The Display and Accessibility drawer, as in the Studio design: it slides in from the
// right over a blurred page, and everything behind it is inert until it closes. Escape,
// Close or a click on the page closes it, and focus goes back to the button that opened it.

let lastTrigger: HTMLElement | null = null;

/** The Display and Accessibility button. Each page has one, in its page header's action area (see PageHeader). */
export function A11yTrigger() {
  const s = useA11y();
  return (
    <button
      type="button"
      className="btn dark accessibility-trigger a11y-trigger"
      aria-haspopup="dialog"
      aria-expanded={s.open}
      aria-controls="accessibilityPanel"
      data-a11y-trigger=""
      onClick={(e) => {
        lastTrigger = e.currentTarget;
        setOpen(!getA11y().open);
      }}
    >
      <Icon name="accessibility" />
      <span>Display and Accessibility</span>
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

function DisplaySwitch({ id, title, description, checked, onChange }: { id: string; title: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="accessibility-setting">
      <div>
        <h3 id={`${id}-label`}>{title}</h3>
        <p id={`${id}-description`}>{description}</p>
      </div>
      <button
        type="button"
        className={`display-switch${checked ? " on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

const BACKGROUND = [".skip-link", ".rail", ".workspace", ".compass-root"];

export function A11yPanel() {
  const s = useA11y();
  const uid = useId();
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const p = s.prefs;
  const set = (patch: Partial<DisplayPrefs>) => updatePrefs(patch);

  // Focus moves into the drawer when it opens and back to the button that opened it on close.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (s.open && !wasOpen.current) {
      requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    } else if (!s.open && wasOpen.current) {
      const target = lastTrigger?.isConnected ? lastTrigger : document.querySelector<HTMLElement>("[data-a11y-trigger]");
      target?.focus({ preventScroll: true });
    }
    wasOpen.current = s.open;
  }, [s.open]);

  // Everything behind the drawer is inert, and the page doesn't scroll, until it closes.
  useEffect(() => {
    if (!s.open) return;
    const els = BACKGROUND.flatMap((sel) => [...document.querySelectorAll<HTMLElement>(sel)]).filter((el) => !el.inert);
    els.forEach((el) => { el.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      els.forEach((el) => { el.inert = false; });
      document.body.style.overflow = overflow;
    };
  }, [s.open]);

  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [s.open]);

  // The drawer closes when the page changes.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname && getA11y().open) setOpen(false);
    lastPath.current = pathname;
  }, [pathname]);

  // The saved note shows for a few seconds after the drawer closes.
  useEffect(() => {
    if (!s.toast) return;
    const t = window.setTimeout(clearToast, 3400);
    return () => window.clearTimeout(t);
  }, [s.toast]);

  // Keep Tab inside the drawer.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
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

  return (
    <>
      <div className="accessibility-layer" hidden={!s.open} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <aside
          id="accessibilityPanel"
          ref={panelRef}
          className="accessibility-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${uid}-title`}
          aria-describedby={`${uid}-intro`}
          onKeyDown={onKeyDown}
        >
          <header className="accessibility-header">
            <div>
              <h2 id={`${uid}-title`} ref={titleRef} tabIndex={-1}>Display and Accessibility</h2>
              <p id={`${uid}-intro`}>Make Tutor Compass work for you.</p>
            </div>
            <button type="button" className="accessibility-close" onClick={() => setOpen(false)} aria-label="Close display and accessibility">
              Close <Icon name="close" />
            </button>
          </header>

          <div className="accessibility-options">
            <section className="accessibility-section" aria-labelledby={`${uid}-comfort`}>
              <h2 id={`${uid}-comfort`}>Focus and comfort</h2>
              <DisplaySwitch id={`${uid}-fv`} title="Focus View" description="Hide extra details so the main tasks stand out. Warnings and actions stay." checked={p.focusView} onChange={(v) => set({ focusView: v })} />
              <DisplaySwitch id={`${uid}-rm`} title="Reduce Motion" description="Turn off animation and moving layout changes across the site." checked={p.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
              <DisplaySwitch id={`${uid}-lc`} title="Larger Controls" description="Use bigger buttons and form controls with more space around them." checked={p.largerControls} onChange={(v) => set({ largerControls: v })} />
            </section>
            <section className="accessibility-section" aria-labelledby={`${uid}-reading`}>
              <h2 id={`${uid}-reading`}>Reading</h2>
              <div className="text-size-setting">
                <h3 id={`${uid}-ts`}>Text Size</h3>
                <div className="text-size-controls" role="group" aria-labelledby={`${uid}-ts`}>
                  <button type="button" aria-label="Decrease text size" onClick={() => set({ textSize: stepTextSize(p.textSize, -1) })} disabled={minSize}>A−</button>
                  <output aria-live="polite">{p.textSize}%</output>
                  <button type="button" aria-label="Increase text size" onClick={() => set({ textSize: stepTextSize(p.textSize, 1) })} disabled={maxSize}>A+</button>
                </div>
              </div>
              <fieldset className="theme-setting">
                <legend>Colour Theme</legend>
                <div className="theme-options">
                  {THEMES.map((t) => (
                    <button key={t.value} type="button" aria-pressed={p.theme === t.value} onClick={() => set({ theme: t.value })}>
                      {p.theme === t.value && <Icon name="check" />}{t.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </section>
          </div>

          <footer className="accessibility-footer">
            <p role="status" className={s.message?.tone === "error" ? "error" : undefined}>
              {s.message ? s.message.text : "Changes preview immediately. Save to keep your preferences."}
            </p>
            <div>
              <button type="button" className="btn dark" onClick={savePrefs}>Save Preferences</button>
              <button type="button" ref={resetRef} className="btn outline" onClick={() => { resetPrefs(); resetRef.current?.focus({ preventScroll: true }); }}>Reset</button>
            </div>
          </footer>
        </aside>
      </div>
      <div className={`studio-toast${s.toast ? " show" : ""}`} role="status">{s.toast}</div>
    </>
  );
}
