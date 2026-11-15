import Link from "next/link";
import { cookies } from "next/headers";
import { RECOVERY_COOKIE } from "@/lib/auth/cookies";
import { InfoPage } from "@/components/InfoPage";
import { ResetForm } from "./ResetForm";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("auth.reset.title") };
}
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const { t } = await getI18n();
  const ready = Boolean((await cookies()).get(RECOVERY_COOKIE)?.value);
  return (
    <InfoPage title={t("auth.reset.title")}>
      {ready ? (
        <ResetForm />
      ) : (
        <p>
          {t("auth.reset.expired")} <Link href="/login?mode=forgot">{t("auth.reset.askNew")}</Link> {t("auth.reset.openHere")}
        </p>
      )}
    </InfoPage>
  );
}
