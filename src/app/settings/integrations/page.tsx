import { redirect } from "next/navigation";

// Integrations now live at the bottom of the Coverage page
export default function IntegrationsPage() {
  redirect("/coverage#integrations");
}
