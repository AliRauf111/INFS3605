"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain/types";
import { Icon, type IconName } from "@/components/Icons";
import { useI18n } from "@/components/i18n/I18nProvider";

// The rail's icon buttons. Overview, Requests, Schedule and Insights live in the top bar
// tabs (PillNav), so the rail lists the other pages only. Each name shows in a tooltip on
// hover and focus, and is the link's text for screen readers.
const LINKS = [
  { href: "/briefing", label: "nav.weeklyBriefing", icon: "briefing" },
  { href: "/owner", label: "nav.approvalAlley", icon: "approval" },
  { href: "/knowledge", label: "nav.knowledgeHub", icon: "knowledge" },
  { href: "/subjects", label: "nav.subjects", icon: "subjects" },
  { href: "/payments", label: "nav.payments", icon: "wallet" },
  { href: "/coverage", label: "nav.rulesCoverage", icon: "sliders" },
] as const satisfies ReadonlyArray<{ href: string; label: string; icon: IconName }>;

export function isCurrent(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  if (href === "/knowledge") return path.startsWith("/knowledge") || path.startsWith("/rules");
  return path.startsWith(href);
}

export function NavLinks({ role }: { role: Role }) {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <nav className="rail-links" aria-label={t("shell.mainNav")}>
      {LINKS.map((l) => {
        const on = isCurrent(path, l.href);
        return (
          <Link key={l.href} href={l.href} className={`rail-btn${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
            <Icon name={l.icon} />
            <span>{l.href === "/owner" && role !== "owner" ? t("nav.viewOnly", { page: t(l.label) }) : t(l.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
