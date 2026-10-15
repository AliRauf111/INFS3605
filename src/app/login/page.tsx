import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/db/supabase";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const configured = supabaseConfigured();
  if (configured && (await getSessionUser().catch(() => null))) redirect("/");
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <div style={{ maxWidth: 440, margin: "1rem auto" }} className="stack">
      <h1>Sign in</h1>
      {!configured && (
        <div className="notice error" role="alert">
          The server has no Supabase settings yet. Add SUPABASE_URL and SUPABASE_SECRET_KEY as described in README.md.
        </div>
      )}
      <LoginForm next={safeNext} />
      <div className="notice info">
        <p>Two fictional demo accounts exist: an administrator (Sarah) and the owner. Whoever set up this copy of the app chose their passwords, either in Supabase (Authentication &gt; Users) or with <code>npm run seed:users</code>. Passwords are not stored in the code.</p>
      </div>
    </div>
  );
}
