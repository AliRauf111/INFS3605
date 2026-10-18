import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { NavLinks } from "@/components/NavLinks";
import { Assistant } from "@/components/assistant/Assistant";
import { aiConfigured } from "@/lib/ai/client";

export const metadata: Metadata = {
  title: { default: "Tutor Compass", template: "%s | Tutor Compass" },
  description: "Decision support for small tutoring businesses (INFS3605 alpha, fictional data).",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = supabaseConfigured() ? await getSessionUser().catch(() => null) : null;
  return (
    <html lang="en-AU">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <div className="demo-strip">One place to plan, teach and grow.</div>
        <header className="site-header">
          <div className="header-inner">
            <a href="/" className="brand">
              <svg aria-hidden="true" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#0066cc" /><path d="M16 5l4 11-4 11-4-11z" fill="#fff" /><circle cx="16" cy="16" r="2" fill="#0066cc" /></svg>
              Tutor Compass
            </a>
            {user && <NavLinks role={user.role} />}
            {user && (
              <div className="user-box">
                <span>
                  {user.displayName} <span className="badge">{user.role === "owner" ? "Owner" : "Administrator"}</span>
                </span>
                <form action="/api/auth/logout" method="post">
                  <button className="btn secondary small" type="submit">Sign out</button>
                </form>
              </div>
            )}
          </div>
        </header>
        <main id="main">{children}</main>
        {user && <Assistant firstName={user.displayName.split(" ")[0]} aiLive={aiConfigured()} />}
      </body>
    </html>
  );
}
