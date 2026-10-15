"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DRAFT_LABELS, type DraftKind } from "@/lib/domain/types";
import type { DraftRow } from "@/lib/data/queries";

const SOURCE_TEXT: Record<string, string> = {
  template: "Template",
  live_ai: "Written by live AI",
  simulated: "Simulated",
  edited: "Edited by a person",
};

function DraftBox({ requestId, kind, existing, aiAvailable }: { requestId: string; kind: DraftKind; existing?: DraftRow; aiAvailable: boolean }) {
  const router = useRouter();
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
      if (!res.ok) throw new Error(json.error ?? "That did not work.");
      return json;
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Could not reach the server." });
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
          ? { kind: "warning", text: `Saved, but check this wording: "${json.warnings.join('", "')}". It may promise something that has not happened.` }
          : { kind: "info", text: "Draft saved." },
      );
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{DRAFT_LABELS[kind]}</h3>
        {source && <span className="badge">{SOURCE_TEXT[source] ?? source}</span>}
      </div>
      <label htmlFor={id} className="sr-only">{DRAFT_LABELS[kind]} text</label>
      <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} maxLength={6000} placeholder="No draft yet." style={{ marginTop: "0.5rem" }} />
      {message && <p className={`notice ${message.kind === "error" ? "error" : message.kind === "warning" ? "warning" : "info"}`} role="status" style={{ marginTop: "0.5rem" }}>{message.text}</p>}
      <div className="row" style={{ marginTop: "0.5rem" }}>
        <button className="btn secondary small" type="button" onClick={() => prepare(false)} disabled={busy}>{body ? "Replace with template" : "Prepare draft"}</button>
        {aiAvailable && <button className="btn secondary small" type="button" onClick={() => prepare(true)} disabled={busy}>Draft with AI</button>}
        <button className="btn small" type="button" onClick={save} disabled={busy || !body.trim()}>Save edits</button>
        {body && (
          <button className="btn secondary small" type="button" onClick={() => navigator.clipboard?.writeText(body).then(() => setMessage({ kind: "info", text: "Copied. Paste it into your email or messaging tool." }))}>
            Copy
          </button>
        )}
      </div>
    </div>
  );
}

export function DraftsEditor({ requestId, kinds, drafts, aiAvailable, welfare }: { requestId: string; kinds: DraftKind[]; drafts: DraftRow[]; aiAvailable: boolean; welfare: boolean }) {
  return (
    <section className="stack" aria-labelledby="drafts-heading">
      <div>
        <h2 id="drafts-heading">Drafts</h2>
        <p className="hint">
          Drafts are for you to check, edit and send yourself. Tutor Compass never sends messages.
          {welfare ? " For welfare cases only a restricted factual handover is offered, and it is never sent to the AI." : ""}
        </p>
      </div>
      <div className="grid grid-2">
        {kinds.map((k) => <DraftBox key={k} requestId={requestId} kind={k} existing={drafts.find((d) => d.kind === k)} aiAvailable={aiAvailable} />)}
      </div>
    </section>
  );
}
