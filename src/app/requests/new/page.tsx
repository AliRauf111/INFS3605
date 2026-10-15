import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { aiConfigured } from "@/lib/ai/client";

export const metadata = { title: "New request" };

export default async function NewRequest() {
  await requirePageUser();
  const live = aiConfigured();
  return (
    <div className="stack">
      <h1>New request</h1>
      <p className="muted">Both routes use the same checks and the same rule engine. Nothing is decided until you confirm the facts.</p>
      <div className="grid grid-2">
        <section className="card">
          <h2>Guided wizard</h2>
          <p>Answer five short steps. Best when you already know the details.</p>
          <Link className="btn" href="/requests/new/wizard">Start the wizard</Link>
        </section>
        <section className="card">
          <h2>Paste a message</h2>
          <p>Paste a parent or tutor message and review the suggested answers before anything is checked.</p>
          <p><span className="badge info">{live ? "Live AI is configured" : "Simulated mode: keyword rules, no AI"}</span></p>
          <Link className="btn" href="/requests/new/intake">Paste a message</Link>
        </section>
      </div>
    </div>
  );
}
