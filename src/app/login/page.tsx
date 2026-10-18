import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

// The sign-in page doubles as the landing page: a short story of what Tutor Compass
// does on the left, and the sign-in form on the right. The request cards are fictional
// examples drawn in the same style as the dashboard, not live data.

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const configured = supabaseConfigured();
  if (configured && (await getSessionUser().catch(() => null))) redirect("/");
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <div className="landing">
      <section className="landing-story" aria-labelledby="landing-heading">
        <Logo variant="light" className="landing-logo" />
        <h1 id="landing-heading">Check every request against the owner&apos;s rules before you act.</h1>
        <p className="landing-lead">
          Refunds, lesson changes and payment extensions are checked the moment they come in, then sent to the right person with the reason attached.
        </p>

        <div className="landing-cards" aria-hidden="true">
          <div className="lc lc-back">
            <div className="lc-row"><span className="lc-ref">FAM-07</span><span>Refund · $75.00</span></div>
            <div className="lc-tag amber"><span className="lc-icon" />Amber · owner approves first</div>
          </div>
          <div className="lc lc-mid">
            <div className="lc-row"><span className="lc-ref">BK-1043</span><span>Lesson change</span></div>
            <div className="lc-tag red"><span className="lc-icon" />Red · send to the owner</div>
          </div>
          <div className="lc lc-front">
            <div className="lc-row"><span className="lc-ref">BK-1042</span><span>Refund · $30.00</span></div>
            <div className="lc-row lc-rule"><span className="lc-pill"><span className="lc-icon" />Green</span><code>refund.under_50</code></div>
            <div className="lc-row lc-foot"><span>Inside the rules</span><strong>Ready to record</strong></div>
          </div>
        </div>

        <ul className="landing-points">
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            Every outcome shows the rule behind it, so nobody acts on a guess.
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.8.6 3 2.3 3 4.7" /></svg>
            Owners decide on the hard cases. Admins handle the rest.
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z" /></svg>
            Safety and welfare concerns always reach the owner first.
          </li>
        </ul>
      </section>

      <section className="landing-form" aria-labelledby="signin-heading">
        <div className="landing-form-inner">
          <Logo className="landing-form-logo" />
          <h2 id="signin-heading">Welcome back</h2>
          <p className="landing-sub">Sign in to check and act on requests.</p>
          {!configured && (
            <div className="notice error" role="alert">
              The server has no Supabase settings yet. Add SUPABASE_URL and SUPABASE_SECRET_KEY as described in README.md.
            </div>
          )}
          <LoginForm next={safeNext} />
          <details className="landing-demo">
            <summary>Trying the demo?</summary>
            <p>
              Two fictional demo accounts exist: an administrator (Sarah) and the owner (Alex). Whoever set up this copy of the app chose their passwords,
              so ask them for the details. Passwords are not stored in the code.
            </p>
            <p>Forgotten a password? The owner can reset it in the Supabase dashboard.</p>
          </details>
          <p className="landing-copy">© {new Date().getFullYear()} Tutor Compass</p>
        </div>
      </section>
    </div>
  );
}
