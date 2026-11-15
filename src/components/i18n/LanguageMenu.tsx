"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { LANGUAGES, languageInfo, type Language } from "@/lib/i18n/languages";
import { useI18n, useLanguage } from "./I18nProvider";

// The language selector in the header (and on the sign-in page). A globe button that names
// the current language opens a list of all ten, each in its own script with its English name
// beside it, so English is always easy to find again. No flags: a language isn't a country.
// Arrow keys, Home and End move through the list; Escape or a click elsewhere closes it.

/** "普通话（简体中文）" becomes "普通话" for the button; the list shows the full name. */
export function shortNative(code: Language): string {
  return languageInfo(code).native.split(/[（(]/)[0].trim();
}

export function LanguageMenu({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const { language, pending, failed, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = languageInfo(language);

  useEffect(() => {
    if (!open) return;
    // Start on the chosen language.
    list.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); all[(n + all.length) % all.length]?.focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setOpen(false);
      if (e.key === "Escape") button.current?.focus();
    }
  };

  const choose = async (code: Language) => {
    setOpen(false);
    button.current?.focus();
    await setLanguage(code);
  };

  return (
    <div className={`lang-menu ${className}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="lang-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("language.buttonLabel", { language: current.native, english: current.english })}
        aria-busy={pending ? true : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}
      >
        <Icon name="globe" />
        <span className="lang-name" lang={current.htmlLang}>{shortNative(language)}</span>
        <span className="lang-short" lang={current.htmlLang} aria-hidden="true">{current.short}</span>
        <Icon name="chevron-down" size={16} className="lang-chevron" />
      </button>
      <div className="lang-panel" hidden={!open}>
        <p className="lang-panel-title" id={`${id}-title`}>{t("language.title")}</p>
        <ul id={id} ref={list} role="menu" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
          {LANGUAGES.map((l) => (
            <li key={l.code} role="none">
              <button type="button" role="menuitemradio" aria-checked={l.code === language} tabIndex={-1} onClick={() => choose(l.code)}>
                <span className="lang-option-text">
                  <span className="lang-native" lang={l.htmlLang} dir={l.dir}>{l.native}</span>
                  <span className="lang-english" lang="en">{l.english}</span>
                </span>
                {l.code === language && <Icon name="check" size={18} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {failed && <p className="lang-error" role="alert">{t("language.loadFailed", { language: languageInfo(failed).native })}</p>}
    </div>
  );
}

/** The same choice on the Settings page, as a group of radio buttons. Both stay in step. */
export function LanguageSettings() {
  const { t } = useI18n();
  const { language, pending, failed, setLanguage } = useLanguage();
  const name = useId();
  return (
    <fieldset className="lang-settings">
      <legend className="sr-only">{t("language.title")}</legend>
      <p className="hint">{t("language.settingsHint")}</p>
      <div className="lang-grid">
        {LANGUAGES.map((l) => (
          <label key={l.code} className={`lang-choice${l.code === language ? " selected" : ""}`}>
            <input type="radio" name={name} value={l.code} checked={l.code === language} onChange={() => setLanguage(l.code)} />
            <span className="lang-option-text">
              <span className="lang-native" lang={l.htmlLang} dir={l.dir}>{l.native}</span>
              <span className="lang-english" lang="en">{l.english}</span>
            </span>
            {pending === l.code && <span className="hint">{t("language.loading")}</span>}
          </label>
        ))}
      </div>
      {failed && <p className="notice error" role="alert">{t("language.loadFailed", { language: languageInfo(failed).native })}</p>}
      <p className="hint">{t("language.reviewNote")}</p>
    </fieldset>
  );
}
