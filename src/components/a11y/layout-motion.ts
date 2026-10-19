import { motionReduced } from "@/lib/a11y/motion";

// One coordinated movement when the Display and Accessibility panel opens beside the page.
//
// The page switches to its final layout in one step (an attribute on <html>), then every
// block that moved is animated from where it was on screen to where it now sits (FLIP).
// Starting from where things *are on screen*, not where they were laid out, means a second
// click part-way through reverses smoothly from the current position instead of jumping.
//
//   Queue cards  slide to their new place, and their card background grows or shrinks to the
//                new size. The text inside keeps its size and wrapping, so nothing is scaled.
//   Page blocks  slide, and change width over the same time so text re-flows gradually.
//   Footer       slides with the content above it; its content narrows like the page blocks.
//
// The panel itself slides with a CSS transition, which also reverses from where it is.

export const LAYOUT_MS = 560;
export const LAYOUT_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

let running: Animation[] = [];

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function collect() {
  const main = document.getElementById("main");
  if (!main) return null;
  const tiles = [...main.querySelectorAll<HTMLElement>(".queue-tile")].filter(visible);
  const blocks = [...main.querySelectorAll<HTMLElement>(":scope > :not(.focus-bar) > *, :scope > .focus-bar")].filter(visible);
  const footer = document.querySelector<HTMLElement>(".site-footer");
  const footerInner = footer?.querySelector<HTMLElement>(".footer-inner") ?? null;
  return { tiles, blocks, footer, footerInner };
}

/** Jumps every running layout animation to its end. Used when motion becomes reduced. */
export function finishLayoutMotion(): void {
  for (const a of running) {
    try { a.finish(); } catch { a.cancel(); }
  }
  running = [];
}

function stop(): void {
  for (const a of running) a.cancel();
  running = [];
}

/**
 * Runs `change` (which must update the layout synchronously) and animates the page from its
 * current look into the new layout. With reduced motion, it just makes the change.
 */
export function animateLayout(change: () => void): void {
  const parts = collect();
  if (!parts || motionReduced() || typeof Element.prototype.animate !== "function") {
    stop();
    change();
    return;
  }
  const { tiles, blocks, footer, footerInner } = parts;

  // First: where everything is on screen right now, mid-animation or not.
  const tileFirst = tiles.map((t) => t.getBoundingClientRect());
  const bgFirst = tiles.map((t) => t.querySelector(".qt-bg")?.getBoundingClientRect() ?? null);
  const blockFirst = blocks.map((b) => b.getBoundingClientRect());
  const footerFirst = footer?.getBoundingClientRect() ?? null;
  const innerFirst = footerInner?.getBoundingClientRect() ?? null;

  stop();
  change();

  // Last: the new layout, with nothing moving.
  const tileLast = tiles.map((t) => t.getBoundingClientRect());
  const bgLast = tiles.map((t) => t.querySelector(".qt-bg")?.getBoundingClientRect() ?? null);
  const blockLast = blocks.map((b) => b.getBoundingClientRect());
  const footerLast = footer?.getBoundingClientRect() ?? null;
  const innerLast = footerInner?.getBoundingClientRect() ?? null;

  const timing: KeyframeAnimationOptions = { duration: LAYOUT_MS, easing: LAYOUT_EASE };
  const add = (a: Animation) => {
    running.push(a);
    void a.finished.then(() => { running = running.filter((x) => x !== a); }, () => undefined);
  };

  const blockShift = new Map<HTMLElement, { dx: number; dy: number }>();
  blocks.forEach((b, i) => {
    const f = blockFirst[i];
    const l = blockLast[i];
    const dx = f.left - l.left;
    const dy = f.top - l.top;
    blockShift.set(b, { dx, dy });
    const holdsTiles = tiles.some((t) => b.contains(t));
    const resize = !holdsTiles && Math.abs(f.width - l.width) > 1;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !resize) return;
    add(b.animate(
      resize
        ? [{ transform: `translate(${dx}px, ${dy}px)`, width: `${f.width}px` }, { transform: "none", width: `${l.width}px` }]
        : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      timing,
    ));
  });

  tiles.forEach((t, i) => {
    // The section around the cards moves too, with the same timing, so take its share off.
    const parent = blocks.find((b) => b.contains(t));
    const ps = (parent && blockShift.get(parent)) ?? { dx: 0, dy: 0 };
    const dx = tileFirst[i].left - tileLast[i].left - ps.dx;
    const dy = tileFirst[i].top - tileLast[i].top - ps.dy;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) add(t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], timing));
    const bf = bgFirst[i];
    const bl = bgLast[i];
    const bg = t.querySelector<HTMLElement>(".qt-bg");
    if (bg && bf && bl && (Math.abs(bf.width - bl.width) > 0.5 || Math.abs(bf.height - bl.height) > 0.5)) {
      add(bg.animate([{ width: `${bf.width}px`, height: `${bf.height}px` }, { width: `${bl.width}px`, height: `${bl.height}px` }], timing));
    }
  });

  if (footer && footerFirst && footerLast) {
    const dy = footerFirst.top - footerLast.top;
    if (Math.abs(dy) > 0.5) add(footer.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], timing));
  }
  // The footer's content narrows and slides sideways like the blocks above it.
  if (footerInner && innerFirst && innerLast) {
    const dx = innerFirst.left - innerLast.left;
    if (Math.abs(dx) > 0.5 || Math.abs(innerFirst.width - innerLast.width) > 1) {
      add(footerInner.animate(
        [{ transform: `translateX(${dx}px)`, width: `${innerFirst.width}px` }, { transform: "none", width: `${innerLast.width}px` }],
        timing,
      ));
    }
  }
}
