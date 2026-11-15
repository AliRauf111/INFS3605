// Demo mode: every full page load starts the website from the original fictional demo
// data. Pure helpers, shared by the proxy, the browser and the tests.
//
// A full page load is the browser loading a document: a refresh, typing the address,
// signing in or opening a new tab. Moving between pages inside the app, opening Compass
// and re-rendering are not full page loads, so they never reset anything.

/** The cookie that names the reset this browser's pages were loaded after. Readable by the page. */
export const DEMO_EPOCH_COOKIE = "tc_demo_epoch";

/** On unless the deployment sets DEMO_MODE to off. Every record in this project is fictional demo data. */
export function demoResetEnabled(value: string | undefined): boolean {
  return !/^(off|false|0|no)$/i.test((value ?? "").trim());
}

type HeaderReader = { get(name: string): string | null };

/**
 * Is this request the browser loading a whole page? App navigation and prefetches send
 * Next.js's RSC header; server actions are POSTs; fetches and images aren't documents;
 * speculative prefetch and prerender say so in Sec-Purpose.
 */
export function isFullPageLoad(method: string, headers: HeaderReader): boolean {
  if (method !== "GET") return false;
  if (headers.get("rsc") !== null || headers.get("next-router-prefetch") !== null || headers.get("next-action") !== null) return false;
  if (/prefetch|prerender/i.test(`${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`)) return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest !== null) return dest === "document";
  return (headers.get("accept") ?? "").includes("text/html");
}

/** Read one cookie in the browser. */
export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Should Compass start a fresh chat? Yes after a refresh, and whenever the demo data was
 * reset since the chat was saved, so the chat never talks about records that are gone.
 */
export function freshChat(opts: { reloaded: boolean; savedEpoch: string | null | undefined; currentEpoch: string | null }): boolean {
  if (opts.reloaded) return true;
  return Boolean(opts.currentEpoch && opts.savedEpoch !== opts.currentEpoch);
}
