import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import "./studio.css";
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
  return (
    // suppressHydrationWarning: the boot script below may set data-boot on <html> before React starts.
    <html lang="en-AU" suppressHydrationWarning>
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
        <BootLoader />
        <NavLoader />
        {user ? (
          <>
            <a href="#main" className="skip-link">Skip to content</a>
            <aside className="rail" aria-label="Site">
              <Link href="/" className="brand" aria-label="Tutor Compass Overview"><Icon name="compass" /></Link>
              <span className="rail-line" aria-hidden="true" />
              <NavLinks role={user.role} />
              <div className="rail-bottom">
                <OpenCompassButton className="rail-btn ai-rail" variant="rail" label="Compass AI" />
                <Link href="/support" className="rail-btn"><Icon name="info" /><span>Help and support</span></Link>
                <span className="avatar owner" aria-hidden="true" title={user.displayName}>{initials(user.displayName)}</span>
              </div>
            </aside>
            <div className="workspace">
              <header className="topbar">
                <Link href="/" className="wordmark" aria-label="Tutor Compass Studio, Overview">
                  tutor<span>compass</span><span className="edition" aria-hidden="true">STUDIO</span>
                </Link>
                <PillNav waiting={waiting} />
                <div className="top-actions">
                  {demo && (
                    <span className="demo-pill" data-secondary="" title="Fictional demonstration data. A full page refresh puts it back to its starting state.">
                      <i aria-hidden="true" /> Interactive demo
                    </span>
                  )}
                  <Link href="/requests" className="icon-btn notification" aria-label={`Requests${waiting ? `, ${waiting} in progress` : ""}`}>
                    <Icon name="bell" />
                    {waiting ? <i aria-hidden="true" /> : null}
                  </Link>
                  <UserMenu name={user.displayName} role={user.role === "owner" ? "Owner" : "Administrator"} initials={initials(user.displayName)} />
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
      </body>
    </html>
  );
}
