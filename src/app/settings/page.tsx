import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { PageHeader } from "@/components/PageHeader";
import { LanguageSettings } from "@/components/i18n/LanguageMenu";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("settings.title") };
}

// Settings for the signed-in person. Language is the same setting as the selector in the
// header: both read and change one shared value, so they always agree.
export default async function SettingsPage() {
  const user = await requirePageUser();
  const { t } = await getI18n();
  return (
    <div className="stack settings-page">
      <PageHeader>
        <h1>{t("settings.title")}</h1>
        <p className="muted">{t("settings.intro")}</p>
      </PageHeader>
      <section className="card" aria-labelledby="settings-language">
        <h2 id="settings-language">{t("language.title")}</h2>
        <LanguageSettings />
        <p className="hint">{user.language ? t("settings.savedToAccount") : t("settings.savedToDevice")}</p>
      </section>
      <section className="card" aria-labelledby="settings-display">
        <h2 id="settings-display">{t("a11y.title")}</h2>
        <p>{t("settings.displayText")}</p>
      </section>
      <section className="card" aria-labelledby="settings-integrations">
        <h2 id="settings-integrations">{t("integrations.heading")}</h2>
        <p>{t("settings.integrationsText")} <Link href="/coverage#integrations">{t("settings.integrationsLink")}</Link></p>
      </section>
    </div>
  );
}
