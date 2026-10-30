"use client";
import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

export function ResetForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 8) return setError(t("auth.passwordShort"));
    if (password !== form.get("confirm")) return setError(t("auth.reset.mismatch"));
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? t("auth.reset.failed"));
      setBusy(false);
      return;
    }
    window.location.assign("/login?notice=password_updated");
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="new-password">{t("auth.reset.newPassword")}</label>
        <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <p className="hint">{t("auth.reset.hint")}</p>
      </div>
      <div className="field">
        <label htmlFor="confirm-password">{t("auth.reset.again")}</label>
        <input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <button className="btn login-btn" type="submit" disabled={busy}>{busy ? t("common.saving") : t("auth.reset.save")}</button>
    </form>
  );
}
