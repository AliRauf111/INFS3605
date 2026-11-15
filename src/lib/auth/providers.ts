// Social sign-in providers offered on the sign-in page. Supabase calls Microsoft "azure".
// Each one only works once it is switched on in Supabase; until then the button explains that.
export const PROVIDERS = [
  { id: "apple", label: "Apple" },
  { id: "google", label: "Google" },
  { id: "azure", label: "Microsoft" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export function providerLabel(id: string): string | null {
  return PROVIDERS.find((p) => p.id === id)?.label ?? null;
}
