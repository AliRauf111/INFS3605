"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PendingAccount } from "@/lib/data/access";

const PROVIDER_NAMES: Record<string, string> = { email: "Email", google: "Google", apple: "Apple", azure: "Microsoft" };

export function AccessRequests({ accounts }: { accounts: PendingAccount[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(userId: string, action: "grant" | "decline") {
    if (action === "decline" && !window.confirm("Decline this account? It will be deleted.")) return;
    setBusy(userId);
    setError(null);
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(body.error ?? "That didn't work. Try again.");
    router.refresh();
  }

  return (
    <div className="access-list">
      {error && <p className="notice error" role="alert">{error}</p>}
      {accounts.map((a) => (
        <div key={a.id} className="access-row">
          <div>
            <strong>{a.name}</strong>
            <div className="muted">{a.email} · {PROVIDER_NAMES[a.provider] ?? a.provider}{a.confirmed ? "" : " · Email not confirmed yet"}</div>
          </div>
          <div className="row">
            <button className="btn small" disabled={!a.confirmed || busy === a.id} onClick={() => act(a.id, "grant")}>Give access</button>
            <button className="btn small secondary" disabled={busy === a.id} onClick={() => act(a.id, "decline")}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}
