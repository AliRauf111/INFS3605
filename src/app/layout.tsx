import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import "./studio.css";
import "./i18n.css";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { NavLinks } from "@/components/NavLinks";
import { Assistant } from "@/components/assistant/Assistant";
import { aiConfigured } from "@/lib/ai/client";
import { SiteFooter } from "@/components/SiteFooter";
import { Icon } from "@/components/Icons";
import { PillNav } from "@/components/PillNav";
import { UserMenu } from "@/components/UserMenu";
import { listRequests } from "@/lib/data/queries";
import { countGroups } from "@/lib/overview/status-cards";
import { StudioFoot } from "@/components/StudioFoot";
import { OpenCompassButton } from "@/components/OpenCompassButton";
import { demoResetEnabled } from "@/lib/demo/mode";
import { BOOT_SCRIPT, BootLoader } from "@/components/loader/BootLoader";
import { NavLoader } from "@/components/loader/NavLoader";
import { A11yPanel, FocusViewBar } from "@/components/a11y/A11yPanel";
import { PREFS_SCRIPT } from "@/lib/a11y/prefs";
import { getI18n } from "@/lib/i18n/server";
import { languageInfo } from "@/lib/i18n/languages";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";

export const metadata: Metadata = {
  title: { default: "Tutor Compass", template: "%s | Tutor Compass" },
  description: "Decision support for small tutoring businesses (INFS3605 alpha, fictional data).",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = supabaseConfigured() ? await getSessionUser().catch(() => null) : null;
  // Requests still in one of the three status groups, for the count beside Requests and the bell's dot.
  const waiting = user
    ? await listRequests({ limit: 200 })
        .then((rows) => Object.values(countGroups(rows)).reduce((a, b) => a + b, 0))
        .catch(() => null)
    : null;
  const demo = demoResetEnabled(process.env.DEMO_MODE);
  const { lang, dir, t, resources } = await getI18n();
  return (
    // suppressHydrationWarning: the boot script below may set data-boot on <html> before React starts.
    <html lang={languageInfo(lang).htmlLang} dir={dir} suppressHydrationWarning>
      <head>
        {/* In <head> so it is listening before the app's script files start to load. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        {/* Saved display preferences, applied before the first paint so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      <body className={user ? "app-shell" : undefined}>
        <noscript>
          <style>{`.boot-loader{display:none!important}body>*{visibility:visible!important}`}</style>
        </noscript>
        <I18nProvider lang={lang} resources={resources}>
        <BootLoader />
        <NavLoader />
        {user ? (
          <>
            <a href="#main" className="skip-link">{t("shell.skipToContent")}</a>
            <aside className="rail" aria-label={t("shell.siteNav")}>
              <Link href="/" className="brand" aria-label={t("shell.homeLink")}><Icon name="compass" /></Link>
              <span className="rail-line" aria-hidden="true" />
              <NavLinks role={user.role} />
              <div className="rail-bottom">
                <OpenCompassButton className="rail-btn ai-rail" variant="rail" label={t("shell.compassAi")} />
                <Link href="/support" className="rail-btn"><Icon name="info" /><span>{t("shell.helpSupport")}</span></Link>
                <span className="avatar owner" aria-hidden="true" title={user.displayName}>{initials(user.displayName)}</span>
              </div>
            </aside>
            <div className="workspace">
              <header className="topbar">
                <Link href="/" className="wordmark" aria-label={t("shell.wordmarkLabel")}>
                  tutor<span>compass</span><span className="edition" aria-hidden="true">STUDIO</span>
                </Link>
                <PillNav waiting={waiting} />
                <div className="top-actions">
                  {/* The language selector replaces the "Interactive demo" label; the demo note stays in the strip above the footer. */}
                  <LanguageMenu />
                  <Link href="/requests" className="icon-btn notification" aria-label={waiting ? t("shell.requestsInProgress", { count: waiting }) : t("nav.requests")}>
                    <Icon name="bell" />
                    {waiting ? <i aria-hidden="true" /> : null}
                  </Link>
                  <UserMenu name={user.displayName} role={t(user.role === "owner" ? "domain.role.owner" : "domain.role.admin")} initials={initials(user.displayName)} />
                </div>
              </header>
              <main id="main">
                <FocusViewBar />
                {children}
              </main>
              <StudioFoot demo={demo} />
              <SiteFooter />
            </div>
          </>
        ) : (
          // Signed-out visitors only reach the sign-in page, which brings its own full-screen layout.
          <main id="main" className="main-bare">{children}</main>
        )}
        {user && <A11yPanel />}
        {user && <Assistant firstName={user.displayName.split(" ")[0]} aiLive={aiConfigured()} />}
        </I18nProvider>
      </body>
    </html>
  );
}
