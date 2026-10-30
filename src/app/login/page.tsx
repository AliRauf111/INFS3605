import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { Logo } from "@/components/Logo";
import Link from "next/link";
import { safeNext } from "@/lib/auth/cookies";
import { providerLabel } from "@/lib/auth/providers";
import { AuthPanel, type Message, type Mode } from "./AuthPanel";
import { getI18n } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/core";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("auth.signInTitle") };
}

// The sign-in page doubles as the landing page: a short story of what Tutor Compass
// does on the left, and the sign-in form on the right. The request cards are fictional
// examples drawn in the same style as the dashboard, not live data.

type Search = { next?: string; mode?: string; error?: string; notice?: string; provider?: string };

// Messages for people coming back from an email link or a social sign-in.
function messageFor({ error, notice, provider }: Search, t: Translate): Message {
  if (error === "provider_off") {
    const name = providerLabel(provider ?? "") ?? t("auth.msg.thatService");
    return { tone: "info", text: t("auth.msg.providerOff", { name }) };
  }
  if (error === "provider") return { tone: "error", text: t("auth.msg.provider") };
  if (error === "link") return { tone: "error", text: t("auth.msg.link") };
  if (notice === "pending") return { tone: "info", text: t("auth.msg.pending") };
  if (notice === "confirmed") return { tone: "success", text: t("auth.msg.confirmed") };
  if (notice === "other_browser") return { tone: "info", text: t("auth.msg.otherBrowser") };
  if (notice === "password_updated") return { tone: "success", text: t("auth.msg.passwordUpdated") };
  return null;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const configured = supabaseConfigured();
  if (configured && (await getSessionUser().catch(() => null))) redirect("/");
  const search = await searchParams;
  const { t, fmt } = await getI18n();
  const mode: Mode = search.mode === "signup" || search.mode === "forgot" ? search.mode : "signin";
  return (
    <div className="landing">
      <section className="landing-story" aria-labelledby="landing-heading">
        <Logo variant="light" className="landing-logo" />
        <h1 id="landing-heading">{t("auth.landing.heading")}</h1>
        <p className="landing-lead">
          {t("auth.landing.lead")}
        </p>

        <div className="landing-cards" aria-hidden="true">
          <div className="lc lc-back">
            <div className="lc-row"><span className="lc-ref">FAM-07</span><span>{t("auth.landing.cardRefund", { amount: fmt.money(7500) })}</span></div>
            <div className="lc-tag amber"><span className="lc-icon" />{t("auth.landing.cardAmber")}</div>
          </div>
          <div className="lc lc-mid">
            <div className="lc-row"><span className="lc-ref">BK-1043</span><span>{t("auth.landing.cardLessonChange")}</span></div>
            <div className="lc-tag red"><span className="lc-icon" />{t("auth.landing.cardRed")}</div>
          </div>
          <div className="lc lc-front">
            <div className="lc-row"><span className="lc-ref">BK-1042</span><span>{t("auth.landing.cardRefund", { amount: fmt.money(3000) })}</span></div>
            <div className="lc-row lc-rule"><span className="lc-pill"><span className="lc-icon" />{t("auth.landing.cardGreen")}</span><code dir="ltr">refund.under_50</code></div>
            <div className="lc-row lc-foot"><span>{t("auth.landing.insideRules")}</span><strong>{t("auth.landing.readyToRecord")}</strong></div>
          </div>
        </div>

        <ul className="landing-points">
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            {t("auth.landing.point1")}
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.8.6 3 2.3 3 4.7" /></svg>
            {t("auth.landing.point2")}
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6z" /></svg>
            {t("auth.landing.point3")}
          </li>
        </ul>
      </section>

      <section className="landing-form" aria-labelledby="signin-heading">
        <div className="landing-top">
          <LanguageMenu />
          <p className="landing-help">{t("auth.landing.needHelp")} <Link href="/support">{t("auth.landing.contactSupport")}</Link></p>
        </div>
        <div className="landing-form-inner">
          <Logo className="landing-form-logo" />
          {!configured && (
            <div className="notice error" role="alert">
              {t("auth.landing.notConfigured")}
            </div>
          )}
          <AuthPanel next={safeNext(search.next)} initialMode={mode} message={messageFor(search, t)} demo={
            <details className="landing-demo">
              <summary>{t("auth.landing.demoSummary")}</summary>
              <p>{t("auth.landing.demoText")}</p>
            </details>
          } />
          <p className="landing-copy"><Link href="/privacy">{t("auth.landing.privacy")}</Link> · <Link href="/terms">{t("auth.landing.terms")}</Link> · {t("auth.landing.copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </section>
    </div>
  );
}
