import { requirePageUser } from "@/lib/auth/page";
import { DescribeRule } from "../RulesClient";
import { PageHeader } from "@/components/PageHeader";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("rules.describeRule") };
}

export default async function DescribePage() {
  await requirePageUser("owner");
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHeader><h1>{t("rules.describeRule")}</h1></PageHeader>
      <ol>
        <li>{t("rules.describeStep1")}</li>
        <li>{t("rules.describeStep2")}</li>
        <li>{t("rules.describeStep3")}</li>
        <li>{t("rules.describeStep4")}</li>
      </ol>
      <DescribeRule />
    </div>
  );
}
