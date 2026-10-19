import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { NavLinks } from "@/components/NavLinks";
import { Assistant } from "@/components/assistant/Assistant";
import { aiConfigured } from "@/lib/ai/client";
import { SiteFooter } from "@/components/SiteFooter";
import { Logo } from "@/components/Logo";
import { BOOT_SCRIPT, BootLoader } from "@/components/loader/BootLoader";

export const metadata: Metadata = {
  title: { default: "Tutor Compass", template: "%s | Tutor Compass" },
  description: "Decision support for small tutoring businesses (INFS3605 alpha, fictional data).",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = supabaseConfigured() ? await getSessionUser().catch(() => null) : null;
  return (
    // suppressHydrationWarning: the boot script below may set data-boot on <html> before React starts.
    <html lang="en-AU" suppressHydrationWarning>
      <head>
        {/* In <head> so it is listening before the app's script files start to load. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body>
        <noscript>
          <style>{`.boot-loader{display:none!important}body>*{visibility:visible!important}`}</style>
        </noscript>
        <BootLoader />
        {user && (
          <>
            <a href="#main" className="skip-link">Skip to content</a>
            <div className="demo-strip">One place to plan, teach and grow.</div>
            <header className="site-header">
              <div className="header-inner">
                <a href="/" className="brand"><Logo /></a>
                <NavLinks role={user.role} />
                <div className="user-box">
                  <span>
                    {user.displayName} <span className="badge">{user.role === "owner" ? "Owner" : "Administrator"}</span>
                  </span>
                  <form action="/api/auth/logout" method="post">
                    <button className="btn secondary small" type="submit">Sign out</button>
                  </form>
                </div>
              </div>
            </header>
          </>
        )}
        {/* Signed-out visitors only reach the sign-in page, which brings its own full-screen layout. */}
        <main id="main" className={user ? undefined : "main-bare"}>{children}</main>
        {user && <SiteFooter />}
        {user && <Assistant firstName={user.displayName.split(" ")[0]} aiLive={aiConfigured()} />}
      </body>
    </html>
  );
}
