import { randomUUID } from "node:crypto";
import { requirePageUser } from "@/lib/auth/page";
import { Wizard } from "@/components/Wizard";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request wizard" };

export default async function WizardPage() {
  await requirePageUser();
  // One key per wizard visit. Re-submitting with the same key cannot create a second request.
  const sessionKey = randomUUID();
  return (
    <div className="stack">
      <PageHeader><h1>Request wizard</h1></PageHeader>
      <Wizard mode={{ kind: "create", intakeMethod: "wizard", sessionKey }} />
    </div>
  );
}
