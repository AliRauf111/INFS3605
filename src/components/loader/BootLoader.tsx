"use client";
import { useEffect, useState } from "react";
import { LoadingScreen } from "./LoadingScreen";
import { NAV_UNTIL_KEY } from "./NavLoader";

// The loading screen shown while the website first opens. It covers the page from the
// first paint and fades away once the app has started in the browser and the first
// page's data has arrived (the route's loading.tsx placeholder, marked with
// data-route-pending, has been swapped for the real page). If the page's data fails,
// the page's own error message and Try again link are revealed the same way. Moves
// between pages use NavLoader instead.
//
// State lives on <html data-boot>: unset while loading, "ready" or "failed". The small
// script in BOOT_SCRIPT also sets "failed" if the app's code can't be downloaded (or
// never starts within 4 seconds of the page finishing loading), or if the whole start
// takes more than 20 seconds. This component can't do that if its own code never arrives.

export function BootLoader() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    (window as { __tcStarted?: boolean }).__tcStarted = true; // tells BOOT_SCRIPT the app's code ran
    if (html.dataset.boot === "ready") {
      setGone(true);
      return;
    }
    if (html.dataset.boot) return;
    let settled = false;
    const finish = () => {
      if (settled || html.dataset.boot) return;
      settled = true;
      observer.disconnect();
      // A click on a plain link reloads the whole page. NavLoader asked for the dance to
      // last 3 seconds from that click, so wait out whatever is left of that time.
      let wait = 0;
      try {
        wait = Number(sessionStorage.getItem(NAV_UNTIL_KEY) ?? 0) - Date.now();
        sessionStorage.removeItem(NAV_UNTIL_KEY);
      } catch {}
      if (wait > 0 && wait <= 3000) {
        window.setTimeout(() => reveal(), wait);
        return;
      }
      reveal();
    };
    const reveal = () => {
      if (html.dataset.boot) return;
      html.dataset.boot = "ready";
      // Remove the screen once its 0.3 second fade has finished, so nothing keeps animating.
      window.setTimeout(() => setGone(true), 400);
    };
    const check = () => {
      if (document.querySelector("[data-route-pending]")) return;
      // Wait one frame so the real page has been painted before the fade starts.
      requestAnimationFrame(finish);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, []);

  return gone ? null : <LoadingScreen className="boot-loader" />;
}

/** Runs before the app's own code. Marks a failed start and makes the retry button work. */
export const BOOT_SCRIPT = `(function(){var h=document.documentElement;function fail(){if(!h.dataset.boot)h.dataset.boot="failed"}
addEventListener("error",function(e){var t=e.target;if(t&&(t.tagName==="SCRIPT"||t.tagName==="LINK"))fail()},true);
addEventListener("load",function(){setTimeout(function(){if(!window.__tcStarted)fail()},4000)});
try{if(Number(sessionStorage.getItem("tc-nav-loader-until"))>Date.now())h.dataset.bootNow=""}catch(e){}
setTimeout(fail,20000);
document.addEventListener("click",function(e){if(e.target.closest&&e.target.closest("[data-boot-retry]"))location.reload()});})();`;
