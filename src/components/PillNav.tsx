"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The workspace tabs in the middle of the top bar: Overview, Requests, Schedule and
// Insights. Schedule opens the lesson timetable in the Knowledge Hub. The full list of
// pages stays in the rail on the left.
const ITEMS = [
  { href: "/", label: "Overview", match: (p: string) => p === "/" },
  { href: "/requests", label: "Requests", match: (p: string) => p.startsWith("/requests") },
  { href: "/knowledge#lessons", label: "Schedule", match: (p: string) => p.startsWith("/knowledge") },
  { href: "/insights", label: "Insights", match: (p: string) => p.startsWith("/insights") },
];

export function PillNav({ waiting }: { waiting: number | null }) {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="Workspace">
      {ITEMS.map((i) => {
        const on = i.match(path);
        return (
          <Link key={i.href} href={i.href} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}>
            {i.label}
            {i.label === "Requests" && waiting ? (
              <span><span aria-hidden="true">{waiting}</span><span className="sr-only">, {waiting} waiting</span></span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
