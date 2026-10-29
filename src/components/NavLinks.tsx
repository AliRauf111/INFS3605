"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain/types";
import { Icon, type IconName } from "@/components/Icons";

// The main navigation: a slim rail down the left on wide screens, and a row of rounded
// buttons under the header on smaller ones. Same links, same order, one landmark.
const LINKS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/requests", label: "Requests", icon: "requests" },
  { href: "/owner", label: "Approval Alley", icon: "approval" },
  { href: "/knowledge", label: "Knowledge Hub", icon: "knowledge" },
  { href: "/subjects", label: "Subjects", icon: "subjects" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/coverage", label: "Coverage", icon: "coverage" },
];

export function NavLinks({ role }: { role: Role }) {
  const path = usePathname();
  const current = (href: string) =>
    href === "/" ? path === "/" : href === "/requests" ? path.startsWith("/requests") : href === "/knowledge" ? path.startsWith("/knowledge") || path.startsWith("/rules") : path.startsWith(href);
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l.href) ? "page" : undefined}>
          <span className="nav-icon"><Icon name={l.icon} /></span>
          <span className="nav-label">{l.label}</span>
          {l.href === "/owner" && role !== "owner" ? <span className="sr-only"> (view only)</span> : null}
        </Link>
      ))}
    </nav>
  );
}
