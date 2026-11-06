// One call to the briefing API from the browser. The server checks the role every time.
export async function post(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/briefing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Request failed");
  return json;
}
