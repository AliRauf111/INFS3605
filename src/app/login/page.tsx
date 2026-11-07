import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { safeNext } from "@/lib/auth/cookies";
import { providerLabel } from "@/lib/auth/providers";
import { type Message, type Mode } from "./AuthPanel";
import { LandingOrbit } from "@/components/landing/LandingOrbit";
import "./landing.css";
import { getI18n } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/core";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("auth.signInTitle") };
}

// The sign-in page doubles as the landing page: the "Compass Decision Orbit" design
// (src/components/landing). The orbit cards are fictional examples tied to real demo
// rules, not live data. Sign-in itself is the shared AuthPanel.

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
  const { t } = await getI18n();
  const mode: Mode = search.mode === "signup" || search.mode === "forgot" ? search.mode : "signin";
  return (
    <LandingOrbit
      initialMode={mode}
      message={messageFor(search, t)}
      next={safeNext(search.next)}
      configured={configured}
      signedIn={false}
      year={new Date().getFullYear()}
    />
  );
}
