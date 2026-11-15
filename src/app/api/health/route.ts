import { NextResponse } from "next/server";
import { db, supabaseConfigured } from "@/lib/db/supabase";
import { checkAi } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

// A check that the deployment can reach its database and sign-in service, with hints
// for fixing set-up mistakes. It describes the settings' shape but never their values.
function urlHint(raw: string | undefined): string {
  if (!raw) return "missing";
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return "should start with https://";
    if (u.hostname.endsWith("supabase.com")) return "this is the dashboard address, use the Project URL from Project Settings > Data API";
    if (u.pathname !== "/" && u.pathname !== "") return "has extra text after .supabase.co (the app ignores it, but tidy it when you can)";
    return "looks right";
  } catch {
    return "not a valid web address";
  }
}

function keyHint(raw: string | undefined): string {
  if (!raw) return "missing";
  const k = raw.trim();
  if (k !== raw) return "has spaces at the start or end";
  if (k.startsWith("sb_secret_")) return "secret key (right type)";
  if (k.startsWith("sb_publishable_")) return "publishable key (wrong type, use the secret key)";
  if (k.split(".").length === 3) return "legacy JWT key (works only if it is the service_role key)";
  return "not a recognised Supabase key";
}

export async function GET() {
  const settings = { supabaseUrl: urlHint(process.env.SUPABASE_URL), supabaseSecretKey: keyHint(process.env.SUPABASE_SECRET_KEY) };
  let database = "not_configured";
  let signIn = "not_configured";
  if (supabaseConfigured()) {
    try {
      const { error } = await db().from("requests").select("id", { head: true, count: "exact" });
      database = error ? `error: ${error.code ?? ""} ${error.message ?? ""}`.trim() : "ok";
    } catch (e) {
      database = `error: ${e instanceof Error ? e.message : "unknown"}`;
    }
    try {
      const { error } = await db().auth.admin.listUsers({ page: 1, perPage: 1 });
      signIn = error ? `error: ${error.status ?? ""} ${error.code ?? ""} ${error.message ?? ""}`.replace(/\s+/g, " ").trim() : "ok";
    } catch (e) {
      signIn = `error: ${e instanceof Error ? e.message : "unknown"}`;
    }
  }
  // Compass's tables, so a missing database update shows up here rather than mid-task.
  let compass = "not_configured";
  if (supabaseConfigured()) {
    const { error } = await db().from("agent_proposals").select("id", { head: true, count: "exact" });
    compass = !error ? "ok" : error.code === "42P01" || error.code === "PGRST205" ? "database update not run (sql/compass-assistant.sql)" : `error: ${error.message}`;
  }
  const ai = await checkAi();
  return NextResponse.json({
    app: "ok", database, signIn, settings, compass,
    ai: !ai.configured ? "simulated" : ai.available ? "configured" : "configured_but_unavailable",
    aiDetail: ai.detail,
  });
}
