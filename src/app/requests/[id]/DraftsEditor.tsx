"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftKind } from "@/lib/domain/types";
import type { DraftRow } from "@/lib/data/queries";
import { useI18n } from "@/components/i18n/I18nProvider";

const SOURCES = ["template", "live_ai", "simulated", "edited"] as const;
type Source = (typeof SOURCES)[number];
const isSource = (s: string): s is Source => (SOURCES as readonly string[]).includes(s);

function DraftBox({ requestId, kind, existing, aiAvailable }: { requestId: string; kind: DraftKind; existing?: DraftRow; aiAvailable: boolean }) {
  const router = useRouter();
  const { t } = useI18n();
  const [body, setBody] = useState(existing?.body ?? "");
  const [source, setSource] = useState(existing?.generated_by ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error" | "warning"; text: string } | null>(null);
  const id = `draft-${kind}`;

  async function call(method: "POST" | "PUT", payload: object) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/drafts`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? t("drafts.didNotWork"));
      return json;
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : t("drafts.unreachable") });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function prepare(useAi: boolean) {
    const json = await call("POST", { kind, useAi });
    if (json) {
      setBody(json.body);
      setSource(json.generatedBy);
      setMessage({ kind: "info", text: json.note });
      router.refresh();
    }
  }

  async function save() {
    const json = await call("PUT", { kind, body });
    if (json) {
      setSource("edited");
      setMessage(
        json.warnings?.length
          ? { kind: "warning", text: t("drafts.checkWording", { words: `"${json.warnings.join('", "')}"` }) }
          : { kind: "info", text: t("drafts.saved") },
      );
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{t(`domain.draft.${kind}`)}</h3>
        {source && <span className="badge">{isSource(source) ? t(`drafts.source.${source}`) : source}</span>}
      </div>
      <label htmlFor={id} className="sr-only">{t("drafts.textLabel", { kind: t(`domain.draft.${kind}`) })}</label>
      <textarea id={id} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} maxLength={6000} placeholder={t("drafts.noDraft")} style={{ marginTop: "0.5rem" }} />
      {message && <p className={`notice ${message.kind === "error" ? "error" : message.kind === "warning" ? "warning" : "info"}`} role="status" style={{ marginTop: "0.5rem" }}>{message.text}</p>}
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button className="btn secondary small" type="button" onClick={() => prepare(false)} disabled={busy}>{body ? t("drafts.replace") : t("drafts.prepare")}</button>
        {aiAvailable && <button className="btn secondary small" type="button" onClick={() => prepare(true)} disabled={busy}>{t("drafts.withAi")}</button>}
        <button className="btn small" type="button" onClick={save} disabled={busy || !body.trim()}>{t("drafts.saveEdits")}</button>
        {body && (
          <button className="btn secondary small" type="button" onClick={() => navigator.clipboard?.writeText(body).then(() => setMessage({ kind: "info", text: t("drafts.copied") }))}>
            {t("drafts.copy")}
          </button>
        )}
      </div>
    </div>
  );
}

export function DraftsEditor({ requestId, kinds, drafts, aiAvailable, welfare }: { requestId: string; kinds: DraftKind[]; drafts: DraftRow[]; aiAvailable: boolean; welfare: boolean }) {
  const { t } = useI18n();
  return (
    <section className="stack" aria-labelledby="drafts-heading">
      <div>
        <h2 id="drafts-heading">{t("drafts.heading")}</h2>
        <p className="hint">
          {t("drafts.hint")}
          {welfare ? ` ${t("drafts.welfareHint")}` : ""}
        </p>
        <p className="hint">{t("drafts.languageHint")}</p>
      </div>
      <div className="grid grid-2">
        {kinds.map((k) => <DraftBox key={k} requestId={requestId} kind={k} existing={drafts.find((d) => d.kind === k)} aiAvailable={aiAvailable} />)}
      </div>
    </section>
  );
}
