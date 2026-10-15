"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(url: string) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "That did not work.");
  return json;
}

export function RefreshSuggestions({ pending }: { pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="row">
      <button className="btn secondary small" type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const j = await post("/api/suggestions"); setMsg(j.added ? `${j.added} added.` : "No new patterns."); router.refresh(); }
        catch (e) { setMsg(e instanceof Error ? e.message : "Failed."); }
        finally { setBusy(false); }
      }}>{busy ? "Looking…" : `Look for patterns${pending ? ` (${pending} new)` : ""}`}</button>
      {msg && <span role="status">{msg}</span>}
    </div>
  );
}

export function SuggestionControls({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: "draft" | "dismiss") => {
    setBusy(true);
    setError(null);
    try {
      const j = await post(`/api/suggestions/${id}/${action}`);
      if (action === "draft") router.push(`/rules/${j.id}`);
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row">
      <button className="btn small" type="button" disabled={busy} onClick={() => run("draft")}>Turn into a draft rule</button>
      <button className="btn secondary small" type="button" disabled={busy} onClick={() => run("dismiss")}>Dismiss</button>
      {error && <span className="error-text" role="alert">{error}</span>}
    </div>
  );
}
