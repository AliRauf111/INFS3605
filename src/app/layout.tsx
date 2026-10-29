import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { NavLinks } from "@/components/NavLinks";
import { Assistant } from "@/components/assistant/Assistant";
import { aiConfigured } from "@/lib/ai/client";
import { SiteFooter } from "@/components/SiteFooter";
import { Logo, LogoMark } from "@/components/Logo";
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
        {user && (
          <>
            <a href="#main" className="skip-link">Skip to content</a>
            {/* The slim rail: logo, the main navigation and Compass AI. Below 900px it becomes a row under the header. */}
            <aside className="site-rail" aria-label="Site">
              <Link href="/" className="rail-brand" aria-label="Tutor Compass Overview"><LogoMark variant="light" /></Link>
              <NavLinks role={user.role} />
              <div className="rail-foot">
                <OpenCompassButton className="rail-compass" iconOnly label="Ask Compass AI" />
                <span className="rail-avatar" aria-hidden="true" title={user.displayName}>{initials(user.displayName)}</span>
              </div>
            </aside>
            <header className="site-header">
              <div className="header-inner">
                <Link href="/" className="brand"><Logo /></Link>
                {demoResetEnabled(process.env.DEMO_MODE) && (
                  <span className="demo-chip" data-secondary="" title="Fictional demonstration data. A full page refresh puts it back to its starting state.">
                    <span className="demo-dot" aria-hidden="true" /> Demo data, resets on refresh
                  </span>
                )}
                <div className="user-box">
                  <span className="user-name">
                    {user.displayName} <span className="badge role-badge">{user.role === "owner" ? "Owner" : "Administrator"}</span>
                  </span>
                  <form action="/api/auth/logout" method="post">
                    <button className="btn secondary small" type="submit">Sign Out</button>
                  </form>
                </div>
              </div>
            </header>
          </>
        )}
        {/* Signed-out visitors only reach the sign-in page, which brings its own full-screen layout. */}
        <main id="main" className={user ? undefined : "main-bare"}>
          {user && <FocusViewBar />}
          {children}
        </main>
        {user && <SiteFooter />}
        {user && <A11yPanel />}
        {user && <Assistant firstName={user.displayName.split(" ")[0]} aiLive={aiConfigured()} />}
      </body>
    </html>
  );
}
