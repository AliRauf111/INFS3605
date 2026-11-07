import { redirect } from "next/navigation";

// The landing design was previewed here before it became the sign-in page. Old links
// still work: they go to /login with the same query string.

type Search = Record<string, string | string[] | undefined>;

export default async function LandingPreviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const qs = query.toString();
  redirect(qs ? `/login?${qs}` : "/login");
}
