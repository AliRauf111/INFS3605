"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PendingAccount } from "@/lib/data/access";
import { useI18n } from "@/components/i18n/I18nProvider";

// Brand names stay as they are; only "Email" is translated.
const PROVIDER_NAMES: Record<string, string> = { google: "Google", apple: "Apple", azure: "Microsoft" };

export function AccessRequests({ accounts }: { accounts: PendingAccount[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(userId: string, action: "grant" | "decline") {
    if (action === "decline" && !window.confirm(t("owner.access.confirmDecline"))) return;
    setBusy(userId);
    setError(null);
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(body.error ?? t("owner.access.failed"));
    router.refresh();
  }

  return (
    <div className="access-list">
      {error && <p className="notice error" role="alert">{error}</p>}
      {accounts.map((a) => (
        <div key={a.id} className="access-row">
          <div>
            <strong><bdi>{a.name}</bdi></strong>
            <div className="muted"><bdi dir="ltr">{a.email}</bdi> · {a.provider === "email" ? t("owner.access.email") : PROVIDER_NAMES[a.provider] ?? a.provider}{a.confirmed ? "" : ` · ${t("owner.access.notConfirmed")}`}</div>
          </div>
          <div className="row">
            <button className="btn small" disabled={!a.confirmed || busy === a.id} onClick={() => act(a.id, "grant")}>{t("owner.access.grant")}</button>
            <button className="btn small secondary" disabled={busy === a.id} onClick={() => act(a.id, "decline")}>{t("owner.access.decline")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
