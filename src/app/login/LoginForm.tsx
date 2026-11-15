"use client";
import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

export function LoginForm({ next, onForgot }: { next: string; onForgot: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const { t } = useI18n();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? t("auth.signInFailed"));
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : t("common.networkError"));
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="email">{t("auth.email")}</label>
        <input id="email" name="email" type="email" autoComplete="username" placeholder={t("auth.emailPlaceholder")} dir="ltr" required />
      </div>
      <div className="field">
        <div className="label-row">
          <label htmlFor="password">{t("auth.password")}</label>
          <button type="button" className="link-btn" onClick={onForgot}>{t("auth.forgotPassword")}</button>
        </div>
        <div className="password-wrap">
          <input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required />
          <button type="button" className="password-toggle" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-controls="password">
            {show ? t("auth.hidePassword") : t("auth.showPassword")}<span className="sr-only">{t("auth.passwordSr")}</span>
          </button>
        </div>
      </div>
      <button className="btn login-btn" type="submit" disabled={busy}>{busy ? t("auth.signingIn") : t("auth.signIn")}</button>
    </form>
  );
}
