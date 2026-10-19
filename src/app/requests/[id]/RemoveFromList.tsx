"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// The red button under "What happens next". It asks first, then takes the request off
// the lists without deleting anything. A removed request shows a button to put it back.
export function RemoveFromList({ requestId, removed, locked }: { requestId: string; removed: boolean; locked: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removed: next }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "That didn't work. Try again.");
    setConfirming(false);
    if (next) router.push("/?removed=1");
    else router.refresh();
  }

  if (removed) {
    return (
      <div className="remove-box">
        {error && <p className="notice error" role="alert">{error}</p>}
        <button type="button" className="btn secondary remove-btn" disabled={busy} onClick={() => save(false)}>
          {busy ? "Putting it back…" : "Put back in the list"}
        </button>
      </div>
    );
  }

  if (locked) {
    return <p className="hint">Only the owner can remove a request that is waiting for them or raises a welfare concern.</p>;
  }

  return (
    <div className="remove-box">
      {error && <p className="notice error" role="alert">{error}</p>}
      {confirming ? (
        <div className="remove-confirm" role="group" aria-label="Confirm removing this request">
          <p>Remove this request from the list? Its full record is kept, and you can put it back from this page.</p>
          <div className="row">
            <button type="button" className="btn danger" disabled={busy} onClick={() => save(true)}>{busy ? "Removing…" : "Yes, remove it"}</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn danger remove-btn" onClick={() => setConfirming(true)}>Remove from list</button>
      )}
    </div>
  );
}
