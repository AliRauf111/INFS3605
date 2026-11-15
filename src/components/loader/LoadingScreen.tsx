import { CompassAvatar } from "@/components/assistant/CompassAvatar";
import { Logo } from "@/components/Logo";
import "./loader.css";

// The full-screen blue loading screen with Compass dancing in the middle. It only draws
// the screen: whoever renders it decides when it shows and hides (see BootLoader).
// Animations are CSS transforms and opacity, and stop under prefers-reduced-motion.
// When `data-state="failed"` is set on it, or on <html> as data-boot="failed", the
// dancing stops and the error message with a retry button shows instead.

export function LoadingScreen({ className = "", state = "loading" }: { className?: string; state?: "loading" | "failed" }) {
  return (
    <div className={`loading-screen ${className}`} data-state={state}>
      <div className="ls-fade">
        <div className="ls-logo">
          <Logo variant="light" />
        </div>
        <div className="ls-centre">
          <div className="ls-stage" aria-hidden="true">
            <div className="ls-dancer">
              <CompassAvatar size={176} className="ls-avatar" />
            </div>
            <div className="ls-shadow" />
          </div>
          <div className="ls-loading" role="status" aria-live="polite">
            <p className="ls-title">Getting things ready for you</p>
            <p className="ls-sub">A little dance while you wait.</p>
            <div className="ls-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="ls-failed" role="alert">
            <p className="ls-title">Tutor Compass didn&rsquo;t finish loading</p>
            <p className="ls-sub">Check your internet connection, then try again. Nothing you saved has been changed.</p>
            {/* Handled by the small boot script in the layout, so it works even if the app's code failed to load. */}
            <button type="button" className="ls-retry" data-boot-retry>
              Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
