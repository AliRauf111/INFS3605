import { requirePageUser } from "@/lib/auth/page";
import { LoadError } from "@/components/ui";
import { PageActions } from "@/components/PageHeader";
import { Icon } from "@/components/Icons";
import { getI18n } from "@/lib/i18n/server";
import { briefingPageData, isMissingBriefing, type BriefingPageData } from "@/lib/briefing/server";
import { BriefingPage } from "@/components/briefing/BriefingPage";
import "./briefing.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.weeklyBriefing") };
}

// The Weekly Owner Briefing. The server works the briefing out from the records (or reuses
// this week's saved one if it's recent), then the page lays it out. ?id= opens an earlier one.

export default async function WeeklyBriefingPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await requirePageUser();
  const { t } = await getI18n();
  const { id } = await searchParams;
  const head = (mode?: BriefingPageData["mode"]) => (
    <div className="page-head">
      <div>
        <p className="eyebrow">{t("briefing.eyebrow")}</p>
        <h1>{t("briefing.title")} <span aria-hidden="true">✧</span></h1>
        <p className="subheading">{t("briefing.subheading")}</p>
      </div>
      <PageActions className="head-actions">
        {mode && <span className={`bf-env ${mode}`}><i aria-hidden="true" />{t(`briefing.mode.${mode}`)}</span>}
      </PageActions>
    </div>
  );
  let data: BriefingPageData;
  try {
    data = await briefingPageData(user, { id: id && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined });
  } catch (e) {
    if (isMissingBriefing(e)) {
      return (
        <div className="studio briefing">
          {head()}
          <div className="notice studio-notice" role="status"><Icon name="info" /><span>{t("briefing.notSetUp")}</span></div>
        </div>
      );
    }
    return <LoadError error={e} />;
  }
  return (
    <div className="studio briefing">
      {head(data.mode)}
      <BriefingPage data={data} role={user.role} />
    </div>
  );
}
