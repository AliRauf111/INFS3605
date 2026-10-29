"use client";
import { Icon } from "@/components/Icons";

// The slim strip above the site footer, as in the Studio design. In demo mode it offers
// Reset demo: a full page load, which puts every demo record back (see src/proxy.ts).
export function StudioFoot({ demo }: { demo: boolean }) {
  return (
    <div className="studio-foot" data-compass-avoid="">
      <span><Icon name="compass" /> A little clarity. A lot more headspace.</span>
      {demo && (
        <button type="button" onClick={() => window.location.reload()} title="Reloads the page, which puts all demo records back to how they started, for everyone using the demo">
          <Icon name="refresh" /> Reset demo
        </button>
      )}
      <span>{demo ? "Sample data · resets on refresh" : "Your records, your rules"}</span>
    </div>
  );
}
