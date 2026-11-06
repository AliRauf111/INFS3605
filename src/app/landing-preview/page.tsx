import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { safeNext } from "@/lib/auth/cookies";
import { LandingOrbit } from "@/components/landing/LandingOrbit";
import type { Mode } from "@/app/login/AuthPanel";
import "./landing.css";

// Preview of the new landing and sign-in page ("Compass Decision Orbit"). It sits beside
// the current /login page until the design is approved; sign-in here uses exactly the same
// AuthPanel, API routes and Supabase settings as /login. Signed-in visitors can still view
// it, with a link back to the dashboard.

export const metadata = { title: "Welcome" };

type Search = { next?: string; mode?: string };

export default async function LandingPreviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const configured = supabaseConfigured();
  const signedIn = configured ? Boolean(await getSessionUser().catch(() => null)) : false;
  const search = await searchParams;
  const mode: Mode = search.mode === "signup" || search.mode === "forgot" ? search.mode : "signin";
  return (
    <LandingOrbit
      initialMode={mode}
      message={null}
      next={safeNext(search.next)}
      configured={configured}
      signedIn={signedIn}
      year={new Date().getFullYear()}
    />
  );
}
