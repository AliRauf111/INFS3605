"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { BriefingPageData } from "@/lib/briefing/server";
import { SECTION_IDS, type BriefingSettings, type Delivery, type SectionId, type Thresholds } from "@/lib/briefing/types";
import { nextSlot } from "@/lib/briefing/logic";
import { post } from "./api";

// The owner's schedule and email settings, the email preview and the delivery history.
// Saving goes to the server, which checks the role, the recipient and every value again.
// Sending in demo mode is always simulated, and the history says so.

const THRESHOLDS: Array<keyof Thresholds> = ["overdueRedDays", "overdueRedCount", "enquiryAmberHours", "enquiryRedHours", "coverRedHours"];

export function BriefingSettingsPanel({ data }: { data: BriefingPageData }) {
  const { t, fmt } = useI18n();
  const [s, setS] = useState<BriefingSettings>(data.settings!);
  const [busy, setBusy] = useState<"save" | "preview" | "send" | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; to: string | null } | null>(null);
  const [log, setLog] = useState<Delivery[]>(data.deliveries);
  const [nextAt, setNextAt] = useState<string | null>(data.nextSendAt);
  const ids = { day: useId(), time: useId(), to: useId() };
  const demo = data.mode === "demo";

  const set = <K extends keyof BriefingSettings>(k: K, v: BriefingSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const toggleSection = (id: SectionId) => set("sections", s.sections.includes(id) ? s.sections.filter((x) => x !== id) : SECTION_IDS.filter((x) => x === id || s.sections.includes(x)));

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const r = await post({ action: "settings", settings: { enabled: s.enabled, sendDay: s.sendDay, sendTime: s.sendTime, sections: s.sections, recipientId: s.recipientId, adminFinance: s.adminFinance, thresholds: s.thresholds } });
      const saved = r.settings as BriefingSettings;
      setS(saved);
      setNextAt(saved.enabled ? nextSlot(saved, new Date()).at : null);
      setMsg({ tone: "success", text: t("briefing.schedule.saved") });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(null);
    }
  };
  const openPreview = async () => {
    setBusy("preview");
    try {
      setPreview((await post({ action: "preview" })) as { subject: string; html: string; to: string | null });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    setBusy("send");
    setMsg(null);
    try {
      const r = (await post({ action: "send" })) as { status: string; to: string; detail: string };
      const text =
        r.status === "simulated" ? t("briefing.schedule.simulated")
        : r.status === "accepted" ? t("briefing.schedule.accepted", { to: r.to })
        : r.status === "already_sent" ? t("briefing.schedule.alreadySent", { to: r.to })
        : r.detail === "no_recipient" ? t("briefing.schedule.noRecipient")
        : r.status === "skipped" ? t("briefing.schedule.gmailNotConnected")
        : r.detail;
      setMsg({ tone: r.status === "failed" ? "error" : r.status === "accepted" || r.status === "simulated" ? "success" : "info", text });
      const now = new Date().toISOString();
      if (r.status !== "already_sent") setLog((l) => [{ id: now, slotKey: "manual", kind: "manual", recipient: r.to, status: r.status as Delivery["status"], detail: r.detail, attempts: 1, createdAt: now, updatedAt: now, briefingId: null }, ...l]);
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card bf-section bf-settings" aria-labelledby="bf-set-h">
      <div className="card-head bf-head">
        <span className="bf-head-icon" aria-hidden="true"><Icon name="settings" /></span>
        <div>
          <h2 id="bf-set-h">{t("briefing.schedule.heading")}</h2>
          <p className="caption">{t("briefing.schedule.caption")}</p>
        </div>
      </div>
      {msg && <div className={`notice ${msg.tone === "info" ? "studio-notice" : msg.tone}`} role={msg.tone === "error" ? "alert" : "status"}>{msg.text}</div>}

      <label className="bf-switch">
        <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>{t("briefing.schedule.enabled")}</span>
      </label>
      <p className="bf-caption">{s.enabled ? (nextAt ? t("briefing.schedule.next", { when: fmt.dateTime(nextAt) }) : t("briefing.schedule.suggested")) : t("briefing.schedule.off")}</p>

      <div className="bf-form-row">
        <div>
          <label htmlFor={ids.day}>{t("briefing.schedule.day")}</label>
          <select id={ids.day} className="select" value={s.sendDay} onChange={(e) => set("sendDay", Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{t(`briefing.schedule.days.${d as 1}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={ids.time}>{t("briefing.schedule.time")}</label>
          <input id={ids.time} type="time" step={900} value={s.sendTime} onChange={(e) => set("sendTime", e.target.value)} />
        </div>
      </div>

      <div>
        <label htmlFor={ids.to}>{t("briefing.schedule.recipient")}</label>
        <select id={ids.to} className="select" value={s.recipientId ?? ""} onChange={(e) => set("recipientId", e.target.value || null)}>
          {data.recipients.length === 0 && <option value="">{t("briefing.schedule.noRecipient")}</option>}
          {data.recipients.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.email})</option>)}
        </select>
        <p className="bf-caption">{t("briefing.schedule.recipientHelp")}</p>
      </div>

      <fieldset className="bf-fieldset">
        <legend>{t("briefing.schedule.sections")}</legend>
        <div className="bf-checks">
          {SECTION_IDS.map((id) => (
            <label key={id}><input type="checkbox" checked={s.sections.includes(id)} onChange={() => toggleSection(id)} /> {t(`briefing.schedule.section.${id}`)}</label>
          ))}
        </div>
      </fieldset>

      <label className="bf-switch">
        <input type="checkbox" checked={s.adminFinance} onChange={(e) => set("adminFinance", e.target.checked)} />
        <span>{t("briefing.schedule.adminFinance")}</span>
      </label>

      <details className="bf-details">
        <summary>{t("briefing.schedule.thresholds")}</summary>
        <div className="bf-thresholds">
          {THRESHOLDS.map((k) => (
            <label key={k}>
              <span>{t(`briefing.schedule.${k}`)}</span>
              <input type="number" min={1} max={720} value={s.thresholds[k]} onChange={(e) => set("thresholds", { ...s.thresholds, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
      </details>

      <div className="bf-actions">
        <button type="button" className="btn dark" onClick={save} disabled={busy !== null}>{busy === "save" ? t("briefing.schedule.saving") : t("briefing.schedule.save")}</button>
        <button type="button" className="btn outline" onClick={openPreview} disabled={busy !== null}><Icon name="search" /> {t("briefing.schedule.preview")}</button>
        <button type="button" className="btn outline" onClick={send} disabled={busy !== null || (!demo && !data.gmailReady)}>
          <Icon name="bell" /> {busy === "send" ? t("briefing.schedule.sending") : demo ? t("briefing.schedule.simulate") : t("briefing.schedule.sendNow")}
        </button>
      </div>
      <p className="bf-caption">{demo ? t("briefing.schedule.simulated") : data.gmailReady ? t("briefing.schedule.gmailConnected") : t("briefing.schedule.gmailNotConnected")}</p>

      <h3 className="bf-sub">{t("briefing.deliveries.heading")}</h3>
      {log.length === 0 ? (
        <p className="bf-empty">{t("briefing.deliveries.none")}</p>
      ) : (
        <ul className="bf-deliveries">
          {log.slice(0, 8).map((d) => (
            <li key={d.id}>
              <span className={`bf-dstatus ${d.status}`}>{t(`briefing.deliveries.status.${d.status}`)}</span>
              <span>{fmt.dateTime(d.createdAt)} · {t(`briefing.deliveries.kind.${d.kind}`)}{d.recipient ? <> · <bdi>{d.recipient}</bdi></> : null}{d.attempts > 1 ? ` · ${t("briefing.deliveries.attempts", { n: d.attempts })}` : ""}</span>
            </li>
          ))}
        </ul>
      )}

      {preview && <EmailPreview preview={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function EmailPreview({ preview, onClose }: { preview: { subject: string; html: string; to: string | null }; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="bf-dialog" aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <div className="bf-dialog-head">
        <h2 id={titleId}>{t("briefing.email.previewHeading")}</h2>
        <button type="button" className="round-btn" aria-label={t("briefing.email.close")} onClick={() => ref.current?.close()}><Icon name="close" /></button>
      </div>
      <dl className="bf-meta">
        <div><dt>{t("briefing.email.to")}</dt><dd><bdi>{preview.to ?? t("briefing.schedule.noRecipient")}</bdi></dd></div>
        <div><dt>{t("briefing.email.subject")}</dt><dd>{preview.subject}</dd></div>
      </dl>
      {/* A sandboxed frame: the email can't run scripts or reach this page. */}
      <iframe className="bf-frame" title={t("briefing.email.frameTitle")} sandbox="" srcDoc={preview.html} />
    </dialog>
  );
}
