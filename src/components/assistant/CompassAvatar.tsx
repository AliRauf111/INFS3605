import { useId } from "react";

// Compass, the assistant's robot. One vector drawing used in the launcher, the chat
// header and voice mode. The look of each state is set in assistant.css, so reduced
// motion can turn every animation off in one place.

export type AvatarState = "idle" | "wave" | "listening" | "thinking" | "replying" | "speaking" | "success" | "clarify" | "error";

export function CompassAvatar({ state = "idle", size = 72, className = "" }: { state?: AvatarState; size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={`compass-avatar state-${state} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`shell-${id}`} cx="38%" cy="28%" r="80%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.65" stopColor="#eef4fd" />
          <stop offset="1" stopColor="#c9dbf3" />
        </radialGradient>
        <linearGradient id={`face-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2d5c" />
          <stop offset="1" stopColor="#0a1636" />
        </linearGradient>
        <linearGradient id={`blue-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3d8bff" />
          <stop offset="1" stopColor="#0058c7" />
        </linearGradient>
      </defs>

      <g className="ca-body-group">
        {/* Body */}
        <path className="ca-body" d="M38 84 h44 a12 12 0 0 1 12 12 v6 a12 12 0 0 1 -12 12 h-44 a12 12 0 0 1 -12 -12 v-6 a12 12 0 0 1 12 -12z" fill={`url(#shell-${id})`} stroke="#b9cdea" strokeWidth="1" />
        <g className="ca-chest">
          <circle cx="60" cy="99" r="8.5" fill={`url(#blue-${id})`} />
          <path d="M60 92.5 l2.6 6.5 -2.6 6.5 -2.6 -6.5z" fill="#ffffff" />
          <circle cx="60" cy="99" r="1.4" fill="#0058c7" />
        </g>
        {/* Waving arm */}
        <g className="ca-arm">
          <rect x="91" y="86" width="9" height="20" rx="4.5" fill={`url(#shell-${id})`} stroke="#b9cdea" strokeWidth="1" />
          <circle cx="95.5" cy="86" r="4.5" fill={`url(#blue-${id})`} />
        </g>
        <rect className="ca-arm-left" x="20" y="88" width="9" height="18" rx="4.5" fill={`url(#shell-${id})`} stroke="#b9cdea" strokeWidth="1" />

        <g className="ca-head">
          {/* Antenna */}
          <line x1="60" y1="20" x2="60" y2="11" stroke="#8fb4e6" strokeWidth="2.5" strokeLinecap="round" />
          <circle className="ca-antenna" cx="60" cy="9" r="4.2" fill={`url(#blue-${id})`} />
          {/* Side details */}
          <rect x="11" y="42" width="11" height="22" rx="5.5" fill={`url(#blue-${id})`} />
          <rect x="98" y="42" width="11" height="22" rx="5.5" fill={`url(#blue-${id})`} />
          {/* Head */}
          <rect x="18" y="19" width="84" height="64" rx="28" fill={`url(#shell-${id})`} stroke="#b9cdea" strokeWidth="1" />
          <ellipse cx="44" cy="28" rx="14" ry="4" fill="#ffffff" opacity="0.9" />
          {/* Face panel */}
          <rect x="28" y="32" width="64" height="40" rx="18" fill={`url(#face-${id})`} />
          <g className="ca-eyes">
            <rect className="ca-eye ca-eye-left" x="41" y="42" width="11" height="14" rx="5.5" fill="#7cc8ff" />
            <rect className="ca-eye ca-eye-right" x="68" y="42" width="11" height="14" rx="5.5" fill="#7cc8ff" />
          </g>
          <path className="ca-mouth" d="M53 62 q7 5 14 0" fill="none" stroke="#7cc8ff" strokeWidth="2.6" strokeLinecap="round" />
          <path className="ca-mouth-flat" d="M54 63 h12" fill="none" stroke="#7cc8ff" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </g>
      <g className="ca-sparkle">
        <path d="M100 18 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#3d8bff" />
      </g>
    </svg>
  );
}
