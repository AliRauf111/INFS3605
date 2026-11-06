"use client";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";

// Compass AI as a floating orb: a white and lavender sphere with a dark plum visor, two
// glowing eyes, a lit side "ear" and a small green status light. Drawn once in SVG so it
// stays sharp at any size and can be reused wherever Compass appears.
//
// It floats, blinks at uneven intervals, glances towards the cursor, smiles on hover and
// gives a small hop when clicked or when react("cheer") is called. With reduced motion
// (the browser setting or the app's Display panel) it holds still and never blinks.
// All motion is CSS transforms and opacity, so the page stays light.

export type OrbMood = "idle" | "happy" | "cheer" | "focus";
export type CompassOrbHandle = { react: (mood: "cheer" | "focus") => void; lookAt: (x: number, y: number) => void };

function reducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const CompassOrb = forwardRef<CompassOrbHandle, { className?: string; onPoke?: () => void; label?: string }>(function CompassOrb(
  { className = "", onPoke, label = "Compass AI" },
  ref,
) {
  const id = useId().replace(/[:«»]/g, "");
  const root = useRef<HTMLButtonElement>(null);
  const [mood, setMood] = useState<OrbMood>("idle");
  const [blink, setBlink] = useState(false);
  const hover = useRef(false);
  const moodTimer = useRef<number | undefined>(undefined);
  const fixedLook = useRef<{ x: number; y: number } | null>(null);

  const setLook = (x: number, y: number) => {
    const el = root.current;
    if (!el) return;
    el.style.setProperty("--lx", x.toFixed(3));
    el.style.setProperty("--ly", y.toFixed(3));
  };

  const flash = (m: OrbMood, ms: number) => {
    window.clearTimeout(moodTimer.current);
    setMood(m);
    moodTimer.current = window.setTimeout(() => setMood(hover.current ? "happy" : "idle"), ms);
  };

  useImperativeHandle(ref, () => ({
    react: (m) => flash(m, m === "cheer" ? 1600 : 1200),
    // Look towards a point on the page (in px), e.g. the request card that was picked.
    lookAt: (x, y) => {
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = (x - (r.left + r.width / 2)) / (r.width * 0.9);
      const dy = (y - (r.top + r.height / 2)) / (r.height * 0.9);
      const v = { x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) };
      fixedLook.current = v;
      setLook(v.x, v.y);
      window.setTimeout(() => {
        fixedLook.current = null;
      }, 2600);
    },
  }));

  // Blink at uneven intervals, sometimes twice.
  useEffect(() => {
    if (reducedMotion()) return;
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 140);
        if (Math.random() < 0.25) {
          window.setTimeout(() => setBlink(true), 300);
          window.setTimeout(() => setBlink(false), 440);
        }
        loop();
      }, 2200 + Math.random() * 4200);
    };
    loop();
    return () => window.clearTimeout(t);
  }, []);

  // Glance towards the cursor when it is nearby. One listener, throttled to animation frames.
  useEffect(() => {
    if (reducedMotion() || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const update = () => {
      frame = 0;
      const el = root.current;
      if (!el || !last || fixedLook.current) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = last.clientX - cx;
      const dy = last.clientY - cy;
      const reach = Math.max(r.width, 320) * 1.6;
      const dist = Math.hypot(dx, dy);
      if (dist > reach) return setLook(0, 0);
      const pull = 1 - dist / reach;
      setLook(Math.max(-1, Math.min(1, (dx / reach) * 2.2)) * (0.35 + pull * 0.65), Math.max(-1, Math.min(1, (dy / reach) * 2.2)) * (0.35 + pull * 0.65));
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(moodTimer.current), []);

  return (
    <button
      ref={root}
      type="button"
      className={`co mood-${mood}${blink ? " blink" : ""} ${className}`}
      aria-label={label}
      onPointerEnter={() => {
        hover.current = true;
        if (mood === "idle") setMood("happy");
      }}
      onPointerLeave={() => {
        hover.current = false;
        if (mood === "happy") setMood("idle");
      }}
      onClick={() => {
        flash("cheer", 1400);
        onPoke?.();
      }}
    >
      <svg viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`glow-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#d9c8ff" stopOpacity="0.85" />
            <stop offset="0.55" stopColor="#e6dbff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#f3edff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`shell-${id}`} cx="36%" cy="28%" r="78%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#f6f2ff" />
            <stop offset="0.8" stopColor="#ddd0f7" />
            <stop offset="1" stopColor="#bba8ea" />
          </radialGradient>
          <radialGradient id={`rim-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0.82" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.97" stopColor="#c9b2ff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.9" />
          </radialGradient>
          <linearGradient id={`visor-${id}`} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#4a3567" />
            <stop offset="0.5" stopColor="#2c1f45" />
            <stop offset="1" stopColor="#1c1330" />
          </linearGradient>
          <linearGradient id={`visor-edge-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e9dcff" />
            <stop offset="1" stopColor="#9a80d6" />
          </linearGradient>
          <linearGradient id={`eye-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#e8dcff" />
          </linearGradient>
          <radialGradient id={`ear-${id}`} cx="45%" cy="45%" r="60%">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#d7c4ff" />
            <stop offset="1" stopColor="#8d6be0" />
          </radialGradient>
          <radialGradient id={`status-${id}`} cx="38%" cy="32%" r="70%">
            <stop offset="0" stopColor="#e9ffef" />
            <stop offset="0.45" stopColor="#6ee495" />
            <stop offset="1" stopColor="#1fae55" />
          </radialGradient>
          <filter id={`soft-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id={`shadow-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>

        {/* Lavender glow behind everything */}
        <circle cx="200" cy="200" r="196" fill={`url(#glow-${id})`} className="co-aura" />

        {/* Shadow on the "floor"; it shrinks as the orb rises */}
        <ellipse className="co-shadow" cx="200" cy="376" rx="92" ry="11" fill="#8f73d6" opacity="0.35" filter={`url(#shadow-${id})`} />

        <g className="co-float">
          {/* Back halves of the two orbital rings, behind the head */}
          <g className="co-ring co-ring-a" transform="translate(200 214) rotate(-13)">
            <path d="M-186 0 A186 50 0 0 1 186 0" />
            <path className="co-comet" pathLength={120} d="M-186 0 A186 50 0 0 1 186 0" />
          </g>
          <g className="co-ring co-ring-b" transform="translate(200 226) rotate(9)">
            <path d="M-164 0 A164 36 0 0 1 164 0" />
            <path className="co-comet" pathLength={120} d="M-164 0 A164 36 0 0 1 164 0" />
          </g>

          <g className="co-head">
            {/* Head */}
            <circle cx="200" cy="200" r="120" fill={`url(#shell-${id})`} />
            <circle cx="200" cy="200" r="120" fill={`url(#rim-${id})`} />
            <ellipse cx="150" cy="128" rx="46" ry="24" fill="#ffffff" opacity="0.85" transform="rotate(-28 150 128)" />

            {/* Side ear with its lit ring */}
            <g className="co-ear">
              <ellipse cx="312" cy="196" rx="25" ry="40" fill={`url(#shell-${id})`} stroke="#d2c2f5" strokeWidth="1.5" />
              <ellipse cx="315" cy="196" rx="17" ry="28" fill="none" stroke="#a17ff0" strokeWidth="5" className="co-ear-ring" />
              <ellipse cx="315" cy="196" rx="17" ry="28" fill="none" stroke="#c7aefc" strokeWidth="9" opacity="0.5" filter={`url(#soft-${id})`} />
              <ellipse cx="316" cy="196" rx="8" ry="13" fill={`url(#ear-${id})`} />
            </g>

            {/* Face: the visor and eyes move together when Compass looks around */}
            <g className="co-face">
              <rect x="94" y="140" width="190" height="122" rx="58" fill={`url(#visor-edge-${id})`} transform="rotate(-7 189 201)" />
              <rect x="99" y="145" width="180" height="112" rx="53" fill={`url(#visor-${id})`} transform="rotate(-7 189 201)" />
              <path d="M128 166 Q176 142 248 150" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="9" strokeLinecap="round" />
              <g className="co-eyes">
                <g className="co-eyes-open">
                  <rect x="150" y="178" width="24" height="48" rx="12" fill="#c9a8ff" opacity="0.65" filter={`url(#soft-${id})`} />
                  <rect x="206" y="172" width="24" height="48" rx="12" fill="#c9a8ff" opacity="0.65" filter={`url(#soft-${id})`} />
                  <rect className="co-eye" x="152" y="180" width="20" height="44" rx="10" fill={`url(#eye-${id})`} />
                  <rect className="co-eye" x="208" y="174" width="20" height="44" rx="10" fill={`url(#eye-${id})`} />
                </g>
                <g className="co-eyes-happy" fill="none" stroke="#f4ecff" strokeWidth="9" strokeLinecap="round">
                  <path d="M149 208 Q162 186 175 206" />
                  <path d="M205 202 Q218 180 231 200" />
                </g>
              </g>
            </g>
          </g>

          {/* Front halves of the rings, over the head */}
          <g className="co-ring co-ring-a co-front" transform="translate(200 214) rotate(-13)">
            <path d="M186 0 A186 50 0 0 1 -186 0" />
            <path className="co-comet" pathLength={120} d="M186 0 A186 50 0 0 1 -186 0" />
          </g>
          <g className="co-ring co-ring-b co-front" transform="translate(200 226) rotate(9)">
            <path d="M164 0 A164 36 0 0 1 -164 0" />
            <path className="co-comet" pathLength={120} d="M164 0 A164 36 0 0 1 -164 0" />
          </g>

          {/* Green status light: Compass is online */}
          <g className="co-status">
            <circle cx="290" cy="86" r="24" fill="#5fe08a" opacity="0.35" filter={`url(#soft-${id})`} />
            <circle cx="290" cy="86" r="16" fill={`url(#status-${id})`} />
            <ellipse cx="285" cy="80" rx="6" ry="4" fill="#ffffff" opacity="0.8" />
          </g>
        </g>

        {/* Particles and small stars */}
        <g className="co-sparkles" fill="#ffffff">
          <circle cx="58" cy="132" r="3" />
          <circle cx="352" cy="300" r="2.5" />
          <circle cx="330" cy="74" r="2" />
          <circle cx="66" cy="292" r="2.2" />
          <path d="M84 86 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3z" fill="#f1e8ff" />
          <path d="M346 140 l2.4 7 7 2.4 -7 2.4 -2.4 7 -2.4 -7 -7 -2.4 7 -2.4z" fill="#f1e8ff" />
        </g>
      </svg>
    </button>
  );
});
