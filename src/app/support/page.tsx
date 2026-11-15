import Link from "next/link";
import { InfoPage } from "@/components/InfoPage";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("info.support") };
}

// There is no help desk behind Tutor Compass. Each business runs its own copy, so help
// comes from the owner who set it up. SUPPORT_EMAIL (optional, server only) adds a
// contact address when the business has one.

export default async function SupportPage() {
  const email = process.env.SUPPORT_EMAIL?.trim();
  const { t } = await getI18n();
  return (
    <InfoPage title={t("info.supportPage.title")}>
      <section>
        <h2>{t("info.supportPage.whoHeading")}</h2>
        {email ? (
          <p>{t("info.supportPage.emailBefore")} <a href={`mailto:${email}`} dir="ltr">{email}</a> {t("info.supportPage.emailAfter")}</p>
        ) : (
          <p>{t("info.supportPage.owner")}</p>
        )}
      </section>
      <section>
        <h2>{t("info.supportPage.signInHeading")}</h2>
        <ul>
          <li>{t("info.supportPage.tip1")}</li>
          <li>{t("info.supportPage.tip2Before")} <Link href="/login?mode=forgot">{t("info.supportPage.tip2Link")}</Link> {t("info.supportPage.tip2After")}</li>
          <li>{t("info.supportPage.tip3")}</li>
          <li>{t("info.supportPage.tip4")}</li>
        </ul>
      </section>
      <section>
        <h2>{t("info.supportPage.wrongHeading")}</h2>
        <p>{t("info.supportPage.wrong")}</p>
      </section>
    </InfoPage>
  );
}
