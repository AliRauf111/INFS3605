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
  return { url: projectOrigin(url), key: key.trim() };
}

/**
 * People often paste the Project URL with extra parts such as "/rest/v1/". Supabase
 * clients add their own paths, so keep only the scheme and host.
 */
export function projectOrigin(raw: string): string {
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return raw.trim();
  }
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

/**
 * A throwaway client for the email and social sign-in flows (PKCE). Supabase keeps a
 * one-time "code verifier" between starting a flow and finishing it. On the server we
 * hold it in a small in-memory store, read it back with verifier(), and keep it in an
 * httpOnly cookie until the person returns from the email link or the provider.
 */
export function flowClient(verifier?: string) {
  const { url, key } = settings();
  const store = new Map<string, string>();
  if (verifier) store.set("tc-code-verifier", verifier);
  const client = createClient(url, key, {
    auth: {
      flowType: "pkce",
      persistSession: true, // only so the custom store below is used; it is thrown away after this request
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "tc",
      storage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    },
  });
  return { client, verifier: () => store.get("tc-code-verifier") ?? null };
}

/** Which social sign-in providers are switched on in Supabase (Authentication > Sign In / Providers). */
export async function enabledProviders(): Promise<Record<string, boolean>> {
  const { url, key } = settings();
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, cache: "no-store" });
    if (!res.ok) return {};
    const body = (await res.json()) as { external?: Record<string, boolean> };
    return body.external ?? {};
  } catch {
    return {};
  }
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
