import { getI18n } from "@/lib/i18n/server";
import "./briefing.css";

// Skeleton cards while the briefing is worked out from the records.
export default async function Loading() {
  const { t } = await getI18n();
  return (
    <div className="studio briefing" data-route-pending="">
      <p role="status" className="sr-only">{t("briefing.loading")}</p>
      <div className="bf-skeleton" aria-hidden="true">
        <div className="bf-sk hero" />
        <div className="bf-sk-row">{Array.from({ length: 6 }, (_, i) => <div key={i} className="bf-sk kpi" />)}</div>
        <div className="bf-sk tall" />
        <div className="bf-sk-row two"><div className="bf-sk tall" /><div className="bf-sk tall" /></div>
      </div>
    </div>
  );
}
