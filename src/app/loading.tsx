import { getI18n } from "@/lib/i18n/server";

// Shown while a page's data loads. On the very first load the full-screen loading
// screen covers it and waits for it to go (data-route-pending); after that, moving
// between pages only shows this small line.
export default async function Loading() {
  const { t } = await getI18n();
  return <p role="status" className="muted" data-route-pending="">{t("common.loading")}</p>;
}
