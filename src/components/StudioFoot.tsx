"use client";
import { Icon } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";

// The slim strip above the site footer, as in the Studio design. In demo mode it offers
// Reset demo: a full page load, which puts every demo record back (see src/proxy.ts).
export function StudioFoot({ demo }: { demo: boolean }) {
  const { t } = useI18n();
  return (
    <div className="studio-foot" data-compass-avoid="">
      <span><Icon name="compass" /> {t("shell.foot.tagline")}</span>
      {demo && (
        <button type="button" onClick={() => window.location.reload()} title={t("shell.foot.resetTitle")}>
          <Icon name="refresh" /> {t("shell.foot.resetDemo")}
        </button>
      )}
      <span>{demo ? t("shell.foot.sampleData") : t("shell.foot.yourRecords")}</span>
    </div>
  );
}
