// The expanded Compass workspace: where it sits on screen, and what happens to the page
// underneath while it is open. Kept free of React so each rule can be tested on its own.

/** The launcher's home on wide screens: 24px from the right edge, 76px across (see assistant.css). */
export const LAUNCHER = { right: 24, size: 76 } as const;
/** Space between the workspace and the launcher column. */
export const COLUMN_GAP = 16;
/** Below this width the workspace uses the whole screen so messages and controls aren't cramped. */
export const FULL_WIDTH_BELOW = 600;
/** The workspace keeps at least this width when the rail stays in view; otherwise it covers the rail too. */
export const MIN_BESIDE_RAIL = 520;
/** The conversation and composer never grow wider than this, so lines stay readable. */
export const READING_WIDTH = 840;

export type ViewportBox = {
  /** Visible viewport width and height (visualViewport, or the window without it). */
  width: number;
  height: number;
  /** How far the visible viewport is from the top of the layout viewport (on-screen keyboards). */
  offsetTop: number;
  /** Width of the navigation rail on the left, which stays in view beside the workspace. 0 or missing when there is none. */
  rail?: number;
};

export type WorkspaceGeometry = {
  mode: "column" | "full";
  top: number;
  left: number;
  width: number;
  height: number;
  /** The narrow strip on the right kept clear for the floating launcher. 0 in full mode. */
  column: number;
  margin: number;
  /** The navigation rail kept in view on the left. 0 in full mode. */
  rail: number;
};

/** Small, even margins: a little more room on large screens. */
export function workspaceMargin(width: number): number {
  return width >= 1100 ? 20 : width >= FULL_WIDTH_BELOW ? 14 : 0;
}

/**
 * The workspace covers almost the whole visible viewport. On desktop and tablet a narrow
 * column on the right stays clear for the launcher and the workspace ends just before it,
 * and the navigation rail on the left (with the logo) stays in view.
 * On phones it uses the full width and height of what is visible above the keyboard.
 */
export function workspaceGeometry(vp: ViewportBox): WorkspaceGeometry {
  const width = Math.max(0, vp.width);
  const height = Math.max(0, vp.height);
  const top = Math.max(0, vp.offsetTop);
  if (width < FULL_WIDTH_BELOW) {
    return { mode: "full", top, left: 0, width, height, column: 0, margin: 0, rail: 0 };
  }
  const margin = workspaceMargin(width);
  const column = LAUNCHER.right + LAUNCHER.size + COLUMN_GAP;
  // The rail stays visible only while it leaves the workspace a sensible width.
  const wanted = Math.max(0, vp.rail ?? 0);
  const rail = width - wanted - column - margin >= MIN_BESIDE_RAIL ? wanted : 0;
  return {
    mode: "column",
    top: top + margin,
    left: rail + margin,
    width: Math.max(0, width - rail - margin - column),
    height: Math.max(0, height - margin * 2),
    column,
    margin,
    rail,
  };
}

/**
 * Where to scroll when a new message arrives while the person is at the bottom. A short
 * reply scrolls fully into view; a long one stops at its top, so it reads from the start.
 */
export function scrollTargetForNew(list: { scrollHeight: number; clientHeight: number }, messageTop: number | null, pad = 12): number {
  const end = Math.max(0, list.scrollHeight - list.clientHeight);
  if (messageTop === null) return end;
  return Math.max(0, Math.min(end, messageTop - pad));
}

/** Within this distance of the bottom counts as "reading the latest message". */
export const NEAR_BOTTOM = 90;
export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
}

// ---------------------------------------------------------------------------
// The page underneath

type StyleLike = { getPropertyValue(p: string): string; setProperty(p: string, v: string): void; removeProperty(p: string): string };
type DocLike = {
  documentElement: { clientWidth: number; style: StyleLike };
};

/**
 * Stops the page scrolling behind the workspace without moving it: the scroll position is
 * kept, and the scrollbar's space is held so nothing shifts sideways. Returns the undo,
 * which puts back exactly what was there before (another panel may also have set these).
 */
export function lockPageScroll(doc: DocLike, innerWidth: number, gutterSupported: boolean): () => void {
  const html = doc.documentElement;
  const scrollbar = Math.max(0, innerWidth - html.clientWidth);
  const saved: [string, string][] = ["overflow", "scrollbar-gutter", "padding-right"].map((p) => [p, html.style.getPropertyValue(p)]);
  html.style.setProperty("overflow", "hidden");
  if (scrollbar > 0) {
    if (gutterSupported) html.style.setProperty("scrollbar-gutter", "stable");
    else html.style.setProperty("padding-right", `${scrollbar}px`);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const [p, v] of saved) {
      if (v) html.style.setProperty(p, v);
      else html.style.removeProperty(p);
    }
  };
}

type ElLike = { tagName: string; inert: boolean };
const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT"]);

/**
 * Makes everything on the page except the Compass layer inert, so it can't be clicked,
 * focused or read by assistive technology. Only elements this call changed are restored,
 * so something that was already inert stays that way.
 */
export function makeSiblingsInert(children: Iterable<ElLike>, keep: ElLike): (() => void) & { add: (els: Iterable<ElLike>) => void } {
  const changed: ElLike[] = [];
  const apply = (els: Iterable<ElLike>) => {
    for (const el of els) {
      if (el === keep || SKIP.has(el.tagName) || el.inert) continue;
      el.inert = true;
      changed.push(el);
    }
  };
  apply(children);
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    for (const el of changed) el.inert = false;
    changed.length = 0;
  };
  return Object.assign(restore, { add: apply });
}

/** Ends anything that is listening or speaking. Closing never touches the conversation itself. */
export function stopMedia(media: { releaseMic: () => void; stopSpeaking: () => void }): void {
  media.releaseMic();
  media.stopSpeaking();
}
