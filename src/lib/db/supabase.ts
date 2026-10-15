import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The server's connection to Supabase. It uses the secret key, which bypasses row level
// security, so it must never be imported into browser code. "server-only" makes the
// build fail if that ever happens.

export class ConfigError extends Error {}

let admin: SupabaseClient | null = null;

function settings() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new ConfigError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set on the server. See .env.example.");
  }
  return { url, key };
}

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function db(): SupabaseClient {
  if (!admin) {
    const { url, key } = settings();
    admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return admin;
}

/** A throwaway client for sign-in and token refresh, so user sessions never mix with the admin client. */
export function authClient(): SupabaseClient {
  const { url, key } = settings();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Turn a database error into a clear exception the API layer can map to a status code. */
export class DbError extends Error {
  constructor(
    message: string,
    public code: "forbidden" | "not_found" | "invalid_transition" | "stale_update" | "reason_required" | "invalid_input" | "policy_frozen" | "unknown",
  ) {
    super(message);
  }
}

export function toDbError(error: { message?: string } | null): DbError {
  const msg = error?.message ?? "Database error";
  const code = (["forbidden", "not_found", "invalid_transition", "stale_update", "reason_required", "invalid_input", "policy_frozen"] as const).find(
    (c) => msg.startsWith(c),
  );
  const clean = msg.includes(":") ? msg.slice(msg.indexOf(":") + 1).trim() : msg;
  return new DbError(code ? clean : "The database could not complete that request.", code ?? "unknown");
}
