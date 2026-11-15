import { requirePageUser } from "@/lib/auth/page";
import { LoadError } from "@/components/ui";
import { PageActions } from "@/components/PageHeader";
import { Icon } from "@/components/Icons";
import { getI18n } from "@/lib/i18n/server";
import { isMissingTable, readPaymentsData, type PaymentsData } from "@/lib/payments/server";
import { PaymentsModule } from "@/components/payments/PaymentsModule";
import "./payments.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("nav.payments") };
}

// Payments: invoices, balances and the Autonomous Payment Recovery Agent. The records are
// read on the server each time the page loads; the four tabs share them in the browser.

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser();
  const { t } = await getI18n();
  const { tab } = await searchParams;
  let data: PaymentsData;
  try {
    data = await readPaymentsData();
  } catch (e) {
    if (isMissingTable(e)) {
      return (
        <div className="studio payments">
          <div className="page-head">
            <div>
              <p className="eyebrow">{t("payments.eyebrow")}</p>
              <h1>{t("payments.title")}</h1>
            </div>
            <PageActions className="head-actions" />
          </div>
          <div className="notice studio-notice" role="status">
            <Icon name="info" />
            <span>{t("payments.notSetUp")}</span>
          </div>
        </div>
      );
    }
    return <LoadError error={e} />;
  }

  return (
    <div className="studio payments">
      <div className="page-head">
        <div>
          <p className="eyebrow">{t("payments.eyebrow")}</p>
          <h1>{t("payments.title")}</h1>
          <p className="subheading">{t("payments.subheading")}</p>
        </div>
        <PageActions className="head-actions">
          <span className={`pay-env ${data.mode}`}>
            <i aria-hidden="true" />
            {data.mode === "live" ? t("payments.mode.live") : t("payments.mode.demo")}
          </span>
        </PageActions>
      </div>
      <PaymentsModule data={data} role={user.role} initialTab={tab} />
    </div>
  );
}
