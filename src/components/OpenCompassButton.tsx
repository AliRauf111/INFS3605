"use client";
import { Icon } from "@/components/Icons";

// Opens the Compass AI workspace. Focus goes back to this button when Compass closes.
export function OpenCompassButton({ className = "btn", label = "Ask Compass AI", iconOnly = false }: { className?: string; label?: string; iconOnly?: boolean }) {
  return (
    <button
      type="button"
      className={className}
      aria-controls="compass-panel"
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={(e) => window.dispatchEvent(new CustomEvent("compass:open", { detail: { opener: e.currentTarget } }))}
    >
      <Icon name="sparkle" />
      {!iconOnly && <span>{label}</span>}
      {!iconOnly && <Icon name="arrow" className="btn-trail" />}
    </button>
  );
}
