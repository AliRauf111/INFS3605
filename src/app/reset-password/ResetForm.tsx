"use client";
import { useState } from "react";

export function ResetForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== form.get("confirm")) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "The password couldn't be changed. Try again.");
      setBusy(false);
      return;
    }
    window.location.assign("/login?notice=password_updated");
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <p className="hint">At least 8 characters.</p>
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Type it again</label>
        <input id="confirm-password" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <button className="btn login-btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
    </form>
  );
}
