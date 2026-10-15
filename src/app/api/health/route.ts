import { NextResponse } from "next/server";
import { db, supabaseConfigured } from "@/lib/db/supabase";
import { aiConfigured } from "@/lib/ai/client";

// A simple check that the deployment can reach its database. It never returns secrets.
export async function GET() {
  let database = "not_configured";
  if (supabaseConfigured()) {
    const { error } = await db().from("requests").select("id", { head: true, count: "exact" });
    database = error ? "error" : "ok";
  }
  return NextResponse.json({ app: "ok", database, ai: aiConfigured() ? "configured" : "simulated" });
}
