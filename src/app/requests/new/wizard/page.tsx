import { randomUUID } from "node:crypto";
import { requirePageUser } from "@/lib/auth/page";
import { Wizard } from "@/components/Wizard";
import { PageHeader } from "@/components/PageHeader";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("intake.wizardTitle") };
}

export default async function WizardPage() {
  await requirePageUser();
  const { t } = await getI18n();
  // One key per wizard visit. Re-submitting with the same key cannot create a second request.
  const sessionKey = randomUUID();
  return (
    <div className="stack">
      <PageHeader><h1>{t("intake.wizardTitle")}</h1></PageHeader>
      <Wizard mode={{ kind: "create", intakeMethod: "wizard", sessionKey }} />
    </div>
  );
}
