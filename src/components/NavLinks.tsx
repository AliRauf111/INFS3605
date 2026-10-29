"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain/types";
import { Icon, type IconName } from "@/components/Icons";

// The main navigation: the round icon buttons down the rail. Each name shows in a tooltip
// on hover and focus, and is the link's text for screen readers.
const LINKS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/requests", label: "Requests", icon: "requests" },
  { href: "/owner", label: "Approval Alley", icon: "approval" },
  { href: "/knowledge", label: "Schedule and Knowledge Hub", icon: "calendar" },
  { href: "/subjects", label: "Subjects", icon: "subjects" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/coverage", label: "Rules and Coverage", icon: "sliders" },
];

export function isCurrent(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  if (href === "/knowledge") return path.startsWith("/knowledge") || path.startsWith("/rules");
  return path.startsWith(href);
}

export function NavLinks({ role }: { role: Role }) {
  const path = usePathname();
  return (
    <nav className="rail-links" aria-label="Main">
      {LINKS.map((l) => {
        const on = isCurrent(path, l.href);
        return (
          <Link key={l.href} href={l.href} className={`rail-btn${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
            <Icon name={l.icon} />
            <span>{l.label}{l.href === "/owner" && role !== "owner" ? " (view only)" : ""}</span>
          </Link>
        );
      })}
    </nav>
  );
}
