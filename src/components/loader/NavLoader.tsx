"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LoadingScreen } from "./LoadingScreen";

// Shows the dancing loading screen for at least MIN_SHOW_MS when someone clicks through to
// another page, so the dance is actually seen. It stays longer only if the new page's
// data is still loading, and hides early never. Going back or forward in the browser
// doesn't trigger it, and nor do clicks that stay on the same page (such as filters).

export const MIN_SHOW_MS = 3000;
/** When a click causes a full page load instead, BootLoader reads this and keeps the screen up until then. */
export const NAV_UNTIL_KEY = "tc-nav-loader-until";
const MAX_SHOW_MS = 12000; // never trap someone if the new page never arrives

type Visit = { at: number; from: string };

export function NavLoader() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"off" | "on" | "leaving">("off");
  const visit = useRef<Visit | null>(null);
  const lastPath = useRef(pathname);
  const historyMove = useRef(false);

  const show = useCallback(() => {
    if (visit.current || document.documentElement.dataset.boot !== "ready") return;
    visit.current = { at: Date.now(), from: lastPath.current };
    try {
      sessionStorage.setItem(NAV_UNTIL_KEY, String(Date.now() + MIN_SHOW_MS));
    } catch {}
    document.documentElement.dataset.navLoading = "";
    setPhase("on");
  }, []);

  const leave = useCallback(() => {
    visit.current = null;
    delete document.documentElement.dataset.navLoading;
    try {
      sessionStorage.removeItem(NAV_UNTIL_KEY);
    } catch {}
    setPhase("leaving");
    window.setTimeout(() => setPhase((p) => (p === "leaving" ? "off" : p)), 350);
  }, []);

  // A click on a link to a different page of this website.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === location.pathname) return;
      show();
    };
    const onPop = () => {
      historyMove.current = true;
    };
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
    };
  }, [show]);

  // Page changes that didn't start from a link, such as clicking a table row.
  useEffect(() => {
    if (pathname === lastPath.current) return;
    if (!visit.current && !historyMove.current) show();
    historyMove.current = false;
    lastPath.current = pathname;
  }, [pathname, show]);

  // Hide once 3 seconds have passed, the new page is showing and its data has arrived.
  useEffect(() => {
    if (phase !== "on") return;
    const check = () => {
      const v = visit.current;
      if (!v) return;
      const elapsed = Date.now() - v.at;
      const arrived = location.pathname !== v.from && !document.querySelector("[data-route-pending]");
      if ((arrived && elapsed >= MIN_SHOW_MS) || elapsed >= MAX_SHOW_MS) leave();
    };
    const timer = window.setInterval(check, 100);
    return () => window.clearInterval(timer);
  }, [phase, leave]);

  if (phase === "off") return null;
  return <LoadingScreen className={`nav-loader${phase === "leaving" ? " is-leaving" : ""}`} />;
}
