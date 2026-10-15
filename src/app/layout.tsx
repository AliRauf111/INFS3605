import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { NavLinks } from "@/components/NavLinks";

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
        <div className="demo-strip">University alpha. All people, bookings and payments are fictional. Nothing is paid, sent or booked.</div>
        <header className="site-header">
          <div className="header-inner">
            <a href="/" className="brand"><span aria-hidden="true">🧭</span> Tutor Compass</a>
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
      </body>
    </html>
  );
}
