import { InfoPage } from "@/components/InfoPage";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("info.privacy") };
}

export default async function PrivacyPage() {
  const { t } = await getI18n();
  return (
    <InfoPage title={t("info.privacy")} updated="2026-10-30">
      <p>{t("info.privacyPage.intro")}</p>
      <section>
        <h2>{t("info.privacyPage.storeHeading")}</h2>
        <ul>
          <li>{t("info.privacyPage.store1")}</li>
          <li>{t("info.privacyPage.store2")}</li>
          <li>{t("info.privacyPage.store3")}</li>
          <li>{t("info.privacyPage.store4")}</li>
        </ul>
        <p>{t("info.privacyPage.storeWhere")}</p>
      </section>
      <section>
        <h2>{t("info.privacyPage.cookiesHeading")}</h2>
        <p>{t("info.privacyPage.cookies")}</p>
        <p>{t("info.privacyPage.cookiesLanguage")}</p>
      </section>
      <section>
        <h2>{t("info.privacyPage.servicesHeading")}</h2>
        <ul>
          <li>{t("info.privacyPage.services1")}</li>
          <li>{t("info.privacyPage.services2")}</li>
          <li>{t("info.privacyPage.services3")}</li>
          <li>{t("info.privacyPage.services4")}</li>
          <li>{t("info.privacyPage.services5")}</li>
        </ul>
      </section>
      <section>
        <h2>{t("info.privacyPage.choicesHeading")}</h2>
        <p>{t("info.privacyPage.choices")}</p>
      </section>
    </InfoPage>
  );
}
