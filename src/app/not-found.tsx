import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { getI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHeader><h1>{t("errors.notFoundTitle")}</h1></PageHeader>
      <div className="card">
        <p>{t("errors.notFoundBody")} <Link href="/">{t("errors.goToDashboard")}</Link>.</p>
      </div>
    </div>
  );
}
