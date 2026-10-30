import { InfoPage } from "@/components/InfoPage";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("info.terms") };
}

export default async function TermsPage() {
  const { t } = await getI18n();
  return (
    <InfoPage title={t("info.termsPage.title")} updated="2026-10-30">
      <p>{t("info.termsPage.intro")}</p>
      <section>
        <h2>{t("info.termsPage.whoHeading")}</h2>
        <p>{t("info.termsPage.who")}</p>
      </section>
      <section>
        <h2>{t("info.termsPage.whatHeading")}</h2>
        <ul>
          <li>{t("info.termsPage.what1")}</li>
          <li>{t("info.termsPage.what2")}</li>
          <li>{t("info.termsPage.what3")}</li>
          <li>{t("info.termsPage.what4")}</li>
        </ul>
      </section>
      <section>
        <h2>{t("info.termsPage.safetyHeading")}</h2>
        <p>{t("info.termsPage.safety")}</p>
      </section>
      <section>
        <h2>{t("info.termsPage.adviceHeading")}</h2>
        <p>{t("info.termsPage.advice")}</p>
      </section>
    </InfoPage>
  );
}
