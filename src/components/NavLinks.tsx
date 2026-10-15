"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain/types";

const LINKS: Array<{ href: string; label: string; owner?: boolean }> = [
  { href: "/", label: "Dashboard" },
  { href: "/requests/new", label: "New request" },
  { href: "/requests", label: "Request log" },
  { href: "/owner", label: "Owner queue" },
  { href: "/knowledge", label: "Knowledge hub" },
  { href: "/rules", label: "Rules" },
  { href: "/coverage", label: "Coverage" },
  { href: "/settings/integrations", label: "Integrations" },
];

export function NavLinks({ role }: { role: Role }) {
  const path = usePathname();
  const current = (href: string) =>
    href === "/" ? path === "/" : href === "/requests" ? path === "/requests" || /^\/requests\/[0-9a-f-]{36}/.test(path) : path.startsWith(href);
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l.href) ? "page" : undefined}>
          {l.label}
          {l.href === "/owner" && role !== "owner" ? <span className="sr-only"> (view only)</span> : null}
        </Link>
      ))}
    </nav>
  );
}
