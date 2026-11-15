// The Tutor Compass logo: an open ring with a compass needle pointing out through the
// gap, and the "tutorcompass" wordmark. "light" is for dark backgrounds.

export function LogoMark({ variant = "dark", className = "" }: { variant?: "dark" | "light"; className?: string }) {
  const ring = variant === "light" ? "#ffffff" : "#233b63";
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M30.5 6.15A19 19 0 1 0 42.35 19.08" fill="none" stroke={ring} strokeWidth="5" strokeLinecap="round" />
      <g className="logo-needle">
        <path d="M36 12 L28.8 24.8 L23.2 19.2 Z" fill={variant === "light" ? "#ffffff" : "#233b63"} />
        <path d="M16.5 31.5 L28.8 24.8 L23.2 19.2 Z" fill="#9dbbe6" />
      </g>
    </svg>
  );
}

export function Logo({ variant = "dark", className = "" }: { variant?: "dark" | "light"; className?: string }) {
  return (
    <span className={`logo ${variant} ${className}`}>
      <LogoMark variant={variant} />
      <span className="logo-word" aria-hidden="true">tutorcompass</span>
      <span className="sr-only">Tutor Compass</span>
    </span>
  );
}
