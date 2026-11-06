"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";

// The workspace tabs in the middle of the top bar: Overview, Requests, Schedule and
// Insights. The rail on the left lists the other pages, so each page has one link.
const ITEMS = [
  { href: "/", label: "nav.overview", match: (p: string) => p === "/" },
  { href: "/requests", label: "nav.requests", match: (p: string) => p.startsWith("/requests") },
  { href: "/schedule", label: "nav.schedule", match: (p: string) => p.startsWith("/schedule") },
  { href: "/insights", label: "nav.insights", match: (p: string) => p.startsWith("/insights") },
] as const;

export function PillNav({ waiting }: { waiting: number | null }) {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <nav className="tabs" aria-label={t("shell.workspaceNav")}>
      {ITEMS.map((i) => {
        const on = i.match(path);
        return (
          <Link key={i.href} href={i.href} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}>
            {t(i.label)}
            {i.href === "/requests" && waiting ? (
              <span><span aria-hidden="true">{waiting}</span><span className="sr-only">{t("shell.waitingCount", { count: waiting })}</span></span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
