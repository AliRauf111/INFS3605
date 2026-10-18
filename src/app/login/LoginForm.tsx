"use client";
import { useState } from "react";

export function LoginForm({ next, onForgot }: { next: string; onForgot: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

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
      if (!res.ok) throw new Error(body.error ?? "Sign in failed.");
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" placeholder="you@tutoringcentre.com.au" required />
      </div>
      <div className="field">
        <div className="label-row">
          <label htmlFor="password">Password</label>
          <button type="button" className="link-btn" onClick={onForgot}>Forgot password?</button>
        </div>
        <div className="password-wrap">
          <input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required />
          <button type="button" className="password-toggle" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-controls="password">
            {show ? "Hide" : "Show"}<span className="sr-only"> password</span>
          </button>
        </div>
      </div>
      <button className="btn login-btn" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
