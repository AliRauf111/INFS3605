"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { RetentionData } from "@/lib/retention/server";
import { ConfirmDialog, ErrorNote, useRetentionAction } from "./shared";
import { StudentsTab } from "./StudentsTab";
import { DraftsTab } from "./DraftsTab";
import { TrackingTab } from "./TrackingTab";

// The Student Retention Agent: three tabs that share one set of records. All three stay
// mounted, so each keeps its place while the others are open. The chosen tab and student
// are kept in the address without reloading.

export const AGENT_TABS = ["students", "drafts", "tracking"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

export function RetentionAgent({ data, initialTab, initialStudent, prepareFor }: { data: RetentionData; initialTab?: AgentTab; initialStudent?: string; prepareFor?: string }) {
  const { t } = useI18n();
  const start: AgentTab = prepareFor ? "drafts" : AGENT_TABS.includes(initialTab as AgentTab) ? (initialTab as AgentTab) : "students";
  const [tab, setTab] = useState<AgentTab>(start);
  const [student, setStudent] = useState<string | null>(initialStudent ?? prepareFor ?? data.assessments.find((a) => a.flagged)?.studentId ?? data.assessments[0]?.studentId ?? null);
  const [focusDraft, setFocusDraft] = useState<string | null>(prepareFor ?? null);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  // Bumped after a demo reset so each tab starts fresh, without old notices or half-typed text.
  const [epoch, setEpoch] = useState(0);
  const refs = useRef<Record<AgentTab, HTMLButtonElement | null>>({ students: null, drafts: null, tracking: null });
  const reset = useRetentionAction();

  // Follow the address when Compass links here with a tab, a student or a draft to open.
  const params = useSearchParams();
  const pTab = params.get("tab");
  const pStudent = params.get("student");
  const pPrepare = params.get("prepare");
  useEffect(() => {
    if (pPrepare) {
      setFocusDraft(pPrepare);
      setStudent(pPrepare);
      setTab("drafts");
      return;
    }
    if (pTab && AGENT_TABS.includes(pTab as AgentTab)) setTab(pTab as AgentTab);
    if (pStudent) setStudent(pStudent);
  }, [pTab, pStudent, pPrepare]);

  function remember(next: AgentTab, id: string | null) {
    const url = new URL(window.location.href);
    url.searchParams.set("retention", "open");
    url.searchParams.set("tab", next);
    if (id) url.searchParams.set("student", id);
    url.searchParams.delete("prepare");
    window.history.replaceState(window.history.state, "", url);
  }
  function choose(next: AgentTab, focus = false) {
    setTab(next);
    remember(next, student);
    if (focus) refs.current[next]?.focus();
  }
  function pick(id: string) {
    setStudent(id);
    remember(tab, id);
  }
  function openDrafts(id?: string) {
    if (id) setFocusDraft(id);
    choose("drafts");
    document.getElementById("ret-agent")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function onKey(e: React.KeyboardEvent) {
    const i = AGENT_TABS.indexOf(tab);
    const rtl = document.documentElement.dir === "rtl";
    const fwd = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd) choose(AGENT_TABS[(i + 1) % AGENT_TABS.length], true);
    else if (e.key === back) choose(AGENT_TABS[(i + AGENT_TABS.length - 1) % AGENT_TABS.length], true);
    else if (e.key === "Home") choose(AGENT_TABS[0], true);
    else if (e.key === "End") choose(AGENT_TABS[AGENT_TABS.length - 1], true);
    else return;
    e.preventDefault();
  }

  const openDraftCount = data.messages.filter((m) => ["draft", "awaiting_approval", "approved", "rejected"].includes(m.status)).length;

  return (
    <div id="ret-agent" className="card ret-agent">
      <div className="ret-agent-head">
        <div>
          <h2>{t("retention.agent.title")}</h2>
          <p className="muted">{t("retention.agent.intro")}</p>
        </div>
      </div>
      {data.mode === "demo" ? (
        <p className="notice info ret-note" role="note"><Icon name="info" size={18} /> <span>{t("retention.agent.demoNote")}</span></p>
      ) : (!data.ready.email || !data.ready.sms) && (
        <p className="notice warning ret-note" role="note"><Icon name="info" size={18} /> <span>{!data.ready.email && !data.ready.sms ? t("retention.agent.noProviders") : !data.ready.email ? t("retention.agent.noGmail") : t("retention.agent.noSms")}</span></p>
      )}

      <div className="ret-tabs" role="tablist" aria-label={t("retention.agent.tabsLabel")} onKeyDown={onKey}>
        {AGENT_TABS.map((id, n) => (
          <button
            key={id}
            ref={(el) => { refs.current[id] = el; }}
            type="button"
            role="tab"
            id={`ret-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`ret-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "active" : undefined}
            onClick={() => choose(id)}
          >
            <span className="ret-tab-num" aria-hidden="true">{n + 1}</span>
            {t(`retention.tabs.${id}`)}
            {id === "drafts" && openDraftCount > 0 && <span className="ret-count">{openDraftCount}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="ret-panel-students" aria-labelledby="ret-tab-students" hidden={tab !== "students"}>
        <StudentsTab key={`s${epoch}`} data={data} selected={student} onSelect={pick} onReviewDrafts={openDrafts} />
      </div>
      <div role="tabpanel" id="ret-panel-drafts" aria-labelledby="ret-tab-drafts" hidden={tab !== "drafts"}>
        <DraftsTab key={`d${epoch}`} data={data} focusStudent={focusDraft} onOpenStudent={(id) => { pick(id); choose("students"); }} onTracking={() => choose("tracking")} />
      </div>
      <div role="tabpanel" id="ret-panel-tracking" aria-labelledby="ret-tab-tracking" hidden={tab !== "tracking"}>
        <TrackingTab key={`t${epoch}`} data={data} onOpenStudent={(id) => { pick(id); choose("students"); }} />
      </div>

      {data.mode === "demo" && (
        <div className="ret-reset">
          <div>
            <p className="ret-reset-title">{t("retention.reset.title")}</p>
            <p className="hint">{resetDone ? t("retention.reset.done") : t("retention.reset.text")}</p>
          </div>
          <button type="button" className="btn secondary" onClick={() => { setResetDone(false); setResetting(true); }} disabled={Boolean(reset.busy)}>
            <Icon name="refresh" size={16} /> {t("retention.reset.button")}
          </button>
          <ErrorNote text={reset.error} onClose={() => reset.setError(null)} />
        </div>
      )}
      {resetting && (
        <ConfirmDialog
          title={t("retention.reset.confirmTitle")}
          confirmLabel={t("retention.reset.confirm")}
          cancelLabel={t("retention.common.cancel")}
          busy={reset.busy === "reset"}
          onCancel={() => setResetting(false)}
          onConfirm={async () => {
            const r = await reset.run("reset", { action: "reset" });
            setResetting(false);
            if (r.ok) {
              setResetDone(true);
              setEpoch((n) => n + 1);
              setFocusDraft(null);
              setTab("students");
              remember("students", null);
            }
          }}
        >
          <p>{t("retention.reset.confirmText")}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
