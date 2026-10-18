import "server-only";
import { db } from "@/lib/db/supabase";

// People who have a Supabase account (from Create account or a social sign-in) but have
// not been given access to Tutor Compass yet. Only the owner sees and manages this list.

export type PendingAccount = {
  id: string;
  email: string;
  name: string;
  provider: string;
  confirmed: boolean;
  createdAt: string;
};

type AuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  created_at: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

export function nameFor(u: Pick<AuthUser, "email" | "user_metadata">): string {
  const meta = u.user_metadata ?? {};
  for (const k of ["display_name", "full_name", "name"]) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
  }
  return (u.email ?? "").split("@")[0].slice(0, 80) || "New team member";
}

export async function pendingAccounts(): Promise<PendingAccount[]> {
  const { data, error } = await db().auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error(`Could not load accounts: ${error.message}`);
  const users = data.users as AuthUser[];
  if (users.length === 0) return [];
  const { data: rows, error: rowsError } = await db().from("app_users").select("id").in("id", users.map((u) => u.id));
  if (rowsError) throw new Error(`Could not load accounts: ${rowsError.message}`);
  const have = new Set((rows ?? []).map((r: { id: string }) => r.id));
  return users
    .filter((u) => !have.has(u.id))
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      name: nameFor(u),
      provider: typeof u.app_metadata?.provider === "string" ? u.app_metadata.provider : "email",
      confirmed: Boolean(u.email_confirmed_at),
      createdAt: u.created_at,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
