"use client";
import { PageHeader } from "@/components/PageHeader";
import { useI18n } from "@/components/i18n/I18nProvider";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <PageHeader><h1>{t("errors.pageTitle")}</h1></PageHeader>
      <div className="notice error" role="alert">
        <p>{t("errors.pageBody")}</p>
        <button className="btn" type="button" onClick={reset}>{t("common.tryAgain")}</button>
      </div>
    </div>
  );
}
