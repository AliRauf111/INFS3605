"use client";

import { useLayoutEffect, type RefObject } from "react";

// Zooms the landing page out on desktop so the whole page fits in the window without
// scrolling. CSS zoom re-lays the page out at the smaller size, so text stays sharp (a
// transform would blur it). Tablet and phone layouts are left alone and scroll as normal.

const DESKTOP_MIN_WIDTH = 1280;
const MIN_ZOOM = 0.55;

export function useFitToScreen(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;

    const reset = () => {
      el.style.removeProperty("zoom");
      el.style.removeProperty("min-height");
    };

    const fit = () => {
      if (window.innerWidth < DESKTOP_MIN_WIDTH) return reset();
      const target = window.innerHeight;
      el.style.minHeight = "0px";
      const heightAt = (z: number) => {
        el.style.setProperty("zoom", String(z));
        return el.getBoundingClientRect().height;
      };
      let zoom = 1;
      if (heightAt(1) > target + 0.5) {
        // Zoom changes the layout width, and the height doesn't shrink in a straight
        // line with it, so search for the largest zoom that still fits.
        let fits = MIN_ZOOM;
        let tooTall = 1;
        for (let i = 0; i < 9; i++) {
          const mid = (fits + tooTall) / 2;
          if (heightAt(mid) <= target) fits = mid;
          else tooTall = mid;
        }
        zoom = fits;
      }
      zoom = Math.floor(zoom * 1000) / 1000;
      if (zoom >= 1) return reset();
      el.style.setProperty("zoom", String(zoom));
      // Fill the window exactly so the background reaches the bottom edge.
      el.style.minHeight = `${target / zoom}px`;
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    fit();
    window.addEventListener("resize", schedule);
    // Switching between sign in and create account, or opening the demo note, changes
    // the height of the sign-in panel.
    el.addEventListener("toggle", schedule, true);
    const later = () => window.setTimeout(schedule, 80);
    el.addEventListener("click", later);
    document.fonts?.ready.then(schedule).catch(() => {});

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      el.removeEventListener("toggle", schedule, true);
      el.removeEventListener("click", later);
      reset();
    };
  }, [ref]);
}
