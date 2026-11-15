"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";

async function post(url: string, fallback: string) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? fallback);
  return json;
}

export function RefreshSuggestions({ pending }: { pending: number }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="row">
      <button className="btn secondary small" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const j = await post("/api/suggestions", t("drafts.didNotWork")); setMsg(j.added ? t("coverage.added", { count: j.added }) : t("coverage.noNewPatterns")); router.refresh(); }
        catch (e) { setMsg(e instanceof Error ? e.message : t("rules.failed")); }
        finally { setBusy(false); }
      }}>{busy ? t("coverage.looking") : pending ? t("coverage.lookNew", { count: pending }) : t("coverage.look")}</button>
      {msg && <span role="status">{msg}</span>}
    </div>
  );
}

export function SuggestionControls({ id }: { id: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: "draft" | "dismiss") => {
    setBusy(true);
    setError(null);
    try {
      const j = await post(`/api/suggestions/${id}/${action}`, t("drafts.didNotWork"));
      if (action === "draft") router.push(`/rules/${j.id}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rules.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row">
      <button className="btn small" type="button" disabled={busy} onClick={() => run("draft")}>{t("coverage.toDraft")}</button>
      <button className="btn secondary small" type="button" disabled={busy} onClick={() => run("dismiss")}>{t("requests.table.dismiss")}</button>
      {error && <span className="error-text" role="alert">{error}</span>}
    </div>
  );
}
