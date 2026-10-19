import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PageActions } from "@/components/PageHeader";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";

// Shell for the short public pages (support, privacy, terms). They can be opened before
// signing in, so they carry their own logo and a way back.
export async function InfoPage({ title, updated, children }: { title: string; updated?: string; children: React.ReactNode }) {
  // Signed in, the site's Display and Accessibility panel is on the page too, so offer its button.
  const user = supabaseConfigured() ? await getSessionUser().catch(() => null) : null;
  return (
    <div className="info-page">
      <div className="info-inner">
        <div className="info-top">
          <Link href="/login" className="info-logo" aria-label="Tutor Compass sign-in page"><Logo /></Link>
          {user && <PageActions />}
        </div>
        <h1>{title}</h1>
        {updated && <p className="info-updated">Last updated {updated}</p>}
        <div className="info-body">{children}</div>
        <p className="info-links">
          <Link href="/login">Back to sign in</Link> · <Link href="/support">Support</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link>
        </p>
      </div>
    </div>
  );
}
