// Line icons used across the signed-in site, drawn like the Studio demo's icon set: 24px
// grid, 1.65 stroke, round ends. Decorative: the text beside each one carries the meaning,
// so they are hidden from screen readers.

const SHAPES = {
  compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" /></>,
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  requests: <path d="M5 4h14l3 12v4H2v-4L5 4ZM2 15h6l2 3h4l2-3h6M8 8h8m-8 3h5" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v5m10-5v5M3 11h18m-13 4h1m6 0h1m-8 3h1" /></>,
  insights: <path d="M4 3v17h17M8 15l4-5 4 2 5-7" />,
  sliders: <><path d="M4 7h7m4 0h5M4 17h2m4 0h10" /><circle cx="13" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  external: <path d="M6 17 17 6M6 6h11v11" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 5v2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  bell: <path d="M5 16V9a7 7 0 0 1 14 0v7l2 2H3l2-2Zm5 5h4" />,
  sparkle: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7 0v4m-2-2h4" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></>,
  book: <path d="M4 3h13a3 3 0 0 1 3 3v15H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-1 15a3 3 0 0 1 3-3h14M8 7h7" />,
  wallet: <path d="M3 6h16v14H3V6Zm0 0 13-3v3m-1 5h6v5h-6v-5Z" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-11v1" /></>,
  accessibility: <><circle cx="12" cy="4" r="2" /><path d="M4 8h16m-8 0v6m0 0-5 7m5-7 5 7M8 8l1 6m7-6-1 6" /></>,
  // Pages the Studio demo doesn't have, drawn in the same style.
  briefing: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v5m10-5v5M3 11h18M7.5 15h5m-5 3h8" /><path d="m17.5 14 .6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z" /></>,
  approval: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4" />,
  knowledge: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6M9 10.5h4" />,
  subjects: <path d="M2.5 9L12 4.5 21.5 9 12 13.5zM6 11v4.5c0 1.5 2.7 3 6 3s6-1.5 6-3V11M21.5 9v5" />,
  coverage: <path d="M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1M21 3l-9 9" />,
  plus: <path d="M12 5v14M5 12h14" />,
  gauge: <path d="M4 17a8 8 0 1 1 16 0M12 17l4-5M3 17h2M19 17h2M12 7V5" />,
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17.5v.01" />,
  stop: <path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7zM12 8v5M12 16.5v.01" />,
  signout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" /></>,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
} as const;

// Icons that point along the reading direction. In right-to-left languages they are
// mirrored (see globals.css); everything else, the logo included, never is.
const DIRECTIONAL = new Set<string>(["arrow", "chevron-left", "chevron-right", "external", "signout"]);

export type IconName = keyof typeof SHAPES;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-flip={DIRECTIONAL.has(name) ? "" : undefined}>
      {SHAPES[name]}
    </svg>
  );
}
