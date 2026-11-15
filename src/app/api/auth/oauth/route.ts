import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { FLOW_COOKIE, FLOW_MAX_AGE, cookieOptions, encodeFlow, safeNext } from "@/lib/auth/cookies";
import { enabledProviders, flowClient, supabaseConfigured } from "@/lib/db/supabase";

// Starts "Continue with Apple / Google / Microsoft". The server builds the provider link
// and sends the browser there; the browser still never talks to Supabase with a key.

const Provider = z.enum(["apple", "google", "azure"]);

export async function GET(req: NextRequest) {
  const back = (query: string) => NextResponse.redirect(new URL(`/login?${query}`, req.url));
  if (!supabaseConfigured()) return back("error=setup");
  const provider = Provider.safeParse(req.nextUrl.searchParams.get("provider"));
  if (!provider.success) return back("error=provider");
  const enabled = await enabledProviders();
  if (!enabled[provider.data]) return back(`error=provider_off&provider=${provider.data}`);

  const { client, verifier } = flowClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: provider.data,
    options: {
      redirectTo: new URL("/api/auth/callback", req.nextUrl.origin).toString(),
      skipBrowserRedirect: true,
      scopes: provider.data === "azure" ? "email" : undefined,
    },
  });
  const v = verifier();
  if (error || !data.url || !v) {
    console.warn("[auth] could not start social sign-in", error?.code ?? "no_url");
    return back("error=provider");
  }
  const res = NextResponse.redirect(data.url);
  res.cookies.set(FLOW_COOKIE, encodeFlow({ v, kind: "signin", next: safeNext(req.nextUrl.searchParams.get("next")) }), cookieOptions(FLOW_MAX_AGE));
  return res;
}
