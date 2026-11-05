"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { FamilyState, MessageStatus } from "@/lib/payments/types";
import type { InvoiceState } from "@/lib/payments/logic";

// Small pieces shared by the four Payments tabs.

/** Calls a Payments API route and refreshes the server data afterwards. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run<T>(key: string, path: string, method: "POST" | "PATCH", body?: unknown): Promise<T | null> {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
        return null;
      }
      router.refresh();
      return json;
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy, error, setError, done, setDone };
}

export function Money({ cents, className }: { cents: number; className?: string }) {
  const { fmt } = useI18n();
  return <span className={className}>{fmt.money(cents, { whole: true })}</span>;
}

const INVOICE_TONE: Record<InvoiceState, string> = { paid: "green", current: "grey", overdue: "red", protected: "amber", voided: "grey" };
export function InvoiceBadge({ state }: { state: InvoiceState }) {
  const { t } = useI18n();
  return <span className={`pay-pill ${INVOICE_TONE[state]}`}>{t(`payments.invoiceState.${state}`)}</span>;
}

const FAMILY_TONE: Record<FamilyState, string> = { eligible: "red", protected: "amber", not_yet: "grey", not_enrolled: "grey", unchecked: "amber" };
export function FamilyBadge({ state }: { state: FamilyState }) {
  const { t } = useI18n();
  return <span className={`pay-pill ${FAMILY_TONE[state]}`}>{t(`payments.familyState.${state}`)}</span>;
}

const MESSAGE_TONE: Record<MessageStatus, string> = { draft: "grey", excluded: "grey", simulated: "lilac", queued: "amber", sent: "green", delivered: "green", failed: "red", blocked: "amber" };
export function MessageBadge({ status }: { status: MessageStatus }) {
  const { t } = useI18n();
  return <span className={`pay-pill ${MESSAGE_TONE[status]}`}>{t(`payments.messageState.${status}`)}</span>;
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="pay-alert red" role="alert">{text}</p>;
}
