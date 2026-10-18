"use client";
import { useEffect, useState } from "react";
import { PROVIDERS, type ProviderId } from "@/lib/auth/providers";
import { LoginForm } from "./LoginForm";

export type Mode = "signin" | "signup" | "forgot";
export type Message = { tone: "error" | "info" | "success"; text: string } | null;

const HEADINGS: Record<Mode, { title: string; sub: string }> = {
  signin: { title: "Welcome Back!", sub: "" },
  signup: { title: "Create your account", sub: "The owner approves new accounts before you can sign in." },
  forgot: { title: "Reset your password", sub: "We'll email you a link to choose a new one." },
};

export function AuthPanel({ next, initialMode, message, demo }: { next: string; initialMode: Mode; message: Message; demo?: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [note, setNote] = useState<Message>(message);
  const switchTo = (m: Mode) => {
    setMode(m);
    setNote(null);
  };
  const h = HEADINGS[mode];

  // A message from a link or a sign-in attempt shows once. Take it out of the address so a
  // reload (or a bookmark) doesn't bring it back.
  useEffect(() => {
    const url = new URL(window.location.href);
    const keys = ["error", "notice", "provider"].filter((k) => url.searchParams.has(k));
    if (keys.length === 0) return;
    keys.forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);

  return (
    <>
      <h2 id="signin-heading">{h.title}</h2>
      {h.sub ? <p className="landing-sub">{h.sub}</p> : <div className="landing-sub-gap" />}

      {mode !== "forgot" && (
        <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
          <button type="button" role="tab" id="tab-signin" aria-selected={mode === "signin"} aria-controls="auth-panel" onClick={() => switchTo("signin")}>Sign in</button>
          <button type="button" role="tab" id="tab-signup" aria-selected={mode === "signup"} aria-controls="auth-panel" onClick={() => switchTo("signup")}>Create account</button>
        </div>
      )}

      <div id="auth-panel" role={mode === "forgot" ? undefined : "tabpanel"} aria-labelledby={mode === "forgot" ? undefined : `tab-${mode}`}>
        {note && <div className={`notice ${note.tone}`} role={note.tone === "error" ? "alert" : "status"}>{note.text}</div>}

        {mode !== "forgot" && (
          <>
            <div className="sso">
              {PROVIDERS.map((p) => (
                <a key={p.id} className="sso-btn" href={`/api/auth/oauth?provider=${p.id}&next=${encodeURIComponent(next)}`}>
                  <ProviderIcon id={p.id} />
                  Continue with {p.label}
                </a>
              ))}
            </div>
            <div className="auth-divider"><span>or use your email</span></div>
          </>
        )}

        {mode === "signin" && <LoginForm next={next} onForgot={() => switchTo("forgot")} />}
        {mode === "signup" && <SignupForm onDone={(text) => { setNote({ tone: "success", text }); setMode("signin"); }} />}
        {mode === "forgot" && <ForgotForm onBack={() => switchTo("signin")} />}

        {mode === "signin" && (
          <p className="auth-switch">New to Tutor Compass? <button type="button" className="link-btn" onClick={() => switchTo("signup")}>Create an account</button></p>
        )}
        {mode === "signin" && demo}
        {mode === "signup" && (
          <p className="auth-switch">Already have an account? <button type="button" className="link-btn" onClick={() => switchTo("signin")}>Sign in</button></p>
        )}
      </div>
    </>
  );
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

function SignupForm({ onDone }: { onDone: (text: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    setBusy(true);
    setError(null);
    const { ok, body } = await post("/api/auth/signup", { name: form.get("name"), email: form.get("email"), password });
    setBusy(false);
    if (!ok) return setError(typeof body.error === "string" ? body.error : "Your account couldn't be created. Try again.");
    onDone(
      body.needsConfirm
        ? "Check your email for a link to confirm your account. After that, the owner needs to give you access before you can sign in."
        : "Your account is set up. The owner needs to give you access before you can sign in.",
    );
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="su-name">Your name</label>
        <input id="su-name" name="name" type="text" autoComplete="name" maxLength={80} required />
      </div>
      <div className="field">
        <label htmlFor="su-email">Work email</label>
        <input id="su-email" name="email" type="email" autoComplete="email" placeholder="you@tutoringcentre.com.au" required />
      </div>
      <div className="field">
        <label htmlFor="su-password">Password</label>
        <input id="su-password" name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" />
      </div>
      <button className="btn login-btn" type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
    </form>
  );
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, body } = await post("/api/auth/forgot", { email: new FormData(e.currentTarget).get("email") });
    setBusy(false);
    if (!ok) return setError(typeof body.error === "string" ? body.error : "The email couldn't be sent. Try again.");
    setSent(true);
  }

  return (
    <>
      {sent ? (
        <div className="notice success" role="status">If that email has an account, a reset link is on its way. Open it in this browser.</div>
      ) : (
        <form className="login-form" onSubmit={onSubmit} noValidate>
          {error && <div className="notice error" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="fp-email">Email</label>
            <input id="fp-email" name="email" type="email" autoComplete="username" placeholder="you@tutoringcentre.com.au" required />
          </div>
          <button className="btn login-btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
      <p className="auth-switch"><button type="button" className="link-btn" onClick={onBack}>Back to sign in</button></p>
    </>
  );
}

function ProviderIcon({ id }: { id: ProviderId }) {
  if (id === "apple") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="sso-icon">
        <path fill="#000" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
      </svg>
    );
  }
  if (id === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="sso-icon">
        <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
        <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sso-icon">
      <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
      <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
      <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
    </svg>
  );
}
