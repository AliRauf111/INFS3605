/** True when movement should be skipped: the device asks for reduced motion, or the person turned on Reduce Motion. */
export function motionReduced(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.getAttribute("data-motion") === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
