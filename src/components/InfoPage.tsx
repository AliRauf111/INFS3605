import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PageActions } from "@/components/PageHeader";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { getI18n } from "@/lib/i18n/server";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";

// Shell for the short public pages (support, privacy, terms). They can be opened before
// signing in, so they carry their own logo, a language menu and a way back.
// `updated` is a calendar day (YYYY-MM-DD), shown in the reader's language.
export async function InfoPage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  // Signed in, the site's Display and Accessibility panel is on the page too, so offer its button.
  const user = supabaseConfigured() ? await getSessionUser().catch(() => null) : null;
  const { t, fmt } = await getI18n();
  return (
    <div className="info-page">
      <div className="info-inner">
        <div className="info-top">
          <Link href="/login" className="info-logo" aria-label={t("info.logoLabel")}><Logo /></Link>
          <div className="row">
            {!user && <LanguageMenu />}
            {user && <PageActions />}
          </div>
        </div>
        <h1>{title}</h1>
        {updated && <p className="info-updated">{t("info.lastUpdated", { date: fmt.date(new Date(`${updated}T02:00:00Z`), { day: "numeric", month: "long", year: "numeric" }) })}</p>}
        <div className="info-body">{children}</div>
        <p className="info-links">
          <Link href="/login">{t("info.backToSignIn")}</Link> · <Link href="/support">{t("info.support")}</Link> · <Link href="/privacy">{t("info.privacy")}</Link> · <Link href="/terms">{t("info.terms")}</Link>
        </p>
      </div>
    </div>
  );
}
