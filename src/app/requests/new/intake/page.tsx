import { randomUUID } from "node:crypto";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";
import { IntakeFlow } from "./IntakeFlow";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paste a message" };

export default async function IntakePage() {
  await requirePageUser();
  return (
    <div className="stack">
      <PageHeader><h1>Paste a message</h1></PageHeader>
      <IntakeFlow sessionKey={randomUUID()} live={aiConfigured()} />
    </div>
  );
}
