"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { RiskLevel, Stage } from "@/lib/retention/types";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/retention/logic";

// Small pieces shared by the Student Retention overview and the agent's three tabs.

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Calls the retention API and refreshes the server data afterwards. One action at a time, so repeated clicks do nothing. */
export function useRetentionAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const run = useCallback(async <T,>(key: string, body: Record<string, unknown>): Promise<ActionResult<T>> => {
    if (lock.current) return { ok: false, error: "busy" };
    lock.current = true;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/retention", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        const msg = json.error ?? `Request failed (${res.status})`;
        setError(msg);
        return { ok: false, error: msg };
      }
      router.refresh();
      return { ok: true, data: json };
    } catch {
      const msg = "Couldn't reach the server. Check your connection and try again.";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }, [router]);
  return { run, busy, error, setError };
}

const LEVEL_TONE: Record<RiskLevel, "red" | "amber" | "green"> = { high: "red", medium: "amber", low: "green" };
export const levelTone = (l: RiskLevel) => LEVEL_TONE[l];

/** The traffic-light shape, so colour is never the only signal. */
export function LightShape({ level }: { level: RiskLevel }) {
  return <span className={`rule-tag-icon lg ${LEVEL_TONE[level]}`} aria-hidden="true" />;
}

export function LevelBadge({ level, score, dismissed }: { level: RiskLevel; score?: number; dismissed?: boolean }) {
  const { t } = useI18n();
  if (dismissed) return <span className="badge">{t("retention.level.dismissed")}</span>;
  return (
    <span className={`badge ${LEVEL_TONE[level]}`}>
      <LightShape level={level} />
      {t(`retention.level.${level}`)}
      {score !== undefined && <span className="ret-score">· {score}</span>}
    </span>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  const tone = STAGE_TONE[stage];
  return <span className={`badge ${tone === "grey" ? "" : tone}`}>{STAGE_LABEL[stage]}</span>;
}

export function ErrorNote({ text, onClose }: { text: string | null; onClose?: () => void }) {
  if (!text || text === "busy") return null;
  return (
    <p className="notice error ret-error" role="alert">
      {text}
      {onClose && <button type="button" className="ret-link" onClick={onClose}>Dismiss</button>}
    </p>
  );
}

/** A modal confirmation built on the page's existing confirm dialog style. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel, onConfirm, onCancel, busy, danger }: {
  title: string; children: React.ReactNode; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    d?.querySelector<HTMLButtonElement>(".confirm-cancel")?.focus();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog ret-dialog"
      aria-labelledby="ret-confirm-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <h2 id="ret-confirm-title">{title}</h2>
      {children}
      <div className="confirm-actions">
        <button type="button" className="btn secondary confirm-cancel" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={`btn${danger ? " danger" : ""}`} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

/** "5 Nov, 3:10 pm" in the reader's language, or a dash. */
export function useWhen() {
  const { fmt } = useI18n();
  return (iso: string | null | undefined) => (iso ? fmt.dateTime(iso) : "–");
}

export function useDay() {
  const { fmt } = useI18n();
  return (iso: string | null | undefined) => (iso ? fmt.date(new Date(`${iso.slice(0, 10)}T02:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) : "–");
}
