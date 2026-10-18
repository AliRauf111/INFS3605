"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/domain/types";

const LINKS: Array<{ href: string; label: string; owner?: boolean }> = [
  { href: "/", label: "Dashboard" },
  { href: "/requests", label: "Requests" },
  { href: "/owner", label: "Approval Alley" },
  { href: "/knowledge", label: "Knowledge Hub" },
  { href: "/coverage", label: "Coverage" },
];

export function NavLinks({ role }: { role: Role }) {
  const path = usePathname();
  const current = (href: string) =>
    href === "/" ? path === "/" : href === "/requests" ? path.startsWith("/requests") : href === "/knowledge" ? path.startsWith("/knowledge") || path.startsWith("/rules") : path.startsWith(href);
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
