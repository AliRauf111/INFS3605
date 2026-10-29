"use client";
import { Icon } from "@/components/Icons";

// Opens the Compass AI workspace. Focus goes back to this button when Compass closes.
// "rail" is the round rail button, its name in a tooltip that is also its accessible name.
export function OpenCompassButton({ className = "btn", label = "Ask Compass AI", variant = "button" }: { className?: string; label?: string; variant?: "button" | "rail" }) {
  return (
    <button
      type="button"
      className={className}
      aria-controls="compass-panel"
      onClick={(e) => window.dispatchEvent(new CustomEvent("compass:open", { detail: { opener: e.currentTarget } }))}
    >
      <Icon name="sparkle" />
      {variant === "rail" ? <span>{label}</span> : <>{label} <Icon name="arrow" className="btn-trail" /></>}
    </button>
  );
}
