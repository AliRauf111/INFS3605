import { createClient } from "@supabase/supabase-js";

// Puts the fictional demo data back to its original state (public.reset_demo_data). Called
// by the proxy before a full page load is rendered, so the page, Compass and every API
// call after it read the fresh data. It never touches records that aren't labelled
// fictional demo data, and the database does it in one transaction.

export type DemoReset = { ok: true; epoch: string } | { ok: false; reason: string };

const TIMEOUT_MS = 8000;

export async function resetDemoData(): Promise<DemoReset> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return { ok: false, reason: "not_configured" };
  let origin = url.trim();
  try {
    origin = new URL(origin).origin;
  } catch {}
  try {
    const client = createClient(origin, key.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc("reset_demo_data").abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) {
      const missing = error.code === "PGRST202" || error.code === "42883" || /demo_seed_missing|reset_demo_data/.test(error.message ?? "");
      return { ok: false, reason: missing ? "not_set_up" : `${error.code ?? ""} ${error.message ?? ""}`.trim() };
    }
    // The Payments module's demo records reset with everything else. A database that hasn't
    // added the Payments tables yet just skips this part.
    const pay = await client.rpc("reset_payments_demo").abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (pay.error && pay.error.code !== "PGRST202" && pay.error.code !== "42883") {
      console.warn(`Payments demo reset skipped: ${pay.error.code ?? ""} ${pay.error.message ?? ""}`.trim());
    }
    const epoch = (data as { resetAt?: string } | null)?.resetAt;
    return { ok: true, epoch: epoch ?? new Date().toISOString() };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unknown" };
  }
}
