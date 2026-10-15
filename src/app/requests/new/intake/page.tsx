import { randomUUID } from "node:crypto";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";
import { IntakeFlow } from "./IntakeFlow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paste a message" };

export default async function IntakePage() {
  await requirePageUser();
  return (
    <div className="stack">
      <h1>Paste a message</h1>
      <IntakeFlow sessionKey={randomUUID()} live={aiConfigured()} />
    </div>
  );
}
