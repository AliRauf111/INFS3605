import { randomUUID } from "node:crypto";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";
import { IntakeFlow } from "./IntakeFlow";
import { PageHeader } from "@/components/PageHeader";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("intake.title") };
}

export default async function IntakePage() {
  await requirePageUser();
  const { t } = await getI18n();
  return (
    <div className="stack">
      <PageHeader><h1>{t("intake.title")}</h1></PageHeader>
      <IntakeFlow sessionKey={randomUUID()} live={aiConfigured()} />
    </div>
  );
}
