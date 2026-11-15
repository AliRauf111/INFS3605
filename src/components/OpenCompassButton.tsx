"use client";
import { Icon, type IconName } from "@/components/Icons";
import type { ShortcutId } from "@/lib/assistant/shortcuts";
import { useI18n } from "@/components/i18n/I18nProvider";

// Opens the Compass AI workspace. Focus goes back to this button when Compass closes.
// "rail" is the round rail button, its name in a tooltip that is also its accessible name.
// With a shortcut, Compass starts that workflow straight away (as if it were chosen on the
// welcome screen). "plain" shows the icon and label with no arrow.
export function OpenCompassButton({ className = "btn", label: given, variant = "button", shortcut, icon = "sparkle" }: {
  className?: string;
  label?: string;
  variant?: "button" | "rail" | "plain";
  shortcut?: ShortcutId;
  icon?: IconName;
}) {
  const { t } = useI18n();
  const label = given ?? t("compass.askCompassAi");
  return (
    <button
      type="button"
      className={className}
      aria-controls="compass-panel"
      onClick={(e) => window.dispatchEvent(new CustomEvent("compass:open", { detail: { opener: e.currentTarget, shortcut } }))}
    >
      <Icon name={icon} />
      {variant === "rail" ? <span>{label}</span> : variant === "plain" ? label : <>{label} <Icon name="arrow" className="btn-trail" /></>}
    </button>
  );
}
