"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { motionReduced } from "@/lib/a11y/motion";

// A link that filters the list on the same page (the dashboard's queue cards and tabs).
// The new list comes from the server, which can take a moment, and staying on the same
// page shows no loading screen. So a click answers straight away: the link shows as
// selected, the list scrolls into view and dims until the filtered rows arrive.
// Without scripts it is an ordinary link.
export function FilterLink({
  href,
  target,
  className,
  current,
  children,
}: {
  href: string;
  /** id of the section that shows the result */
  target: string;
  className?: string;
  current?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!pending) return;
    const section = document.getElementById(target);
    section?.setAttribute("aria-busy", "true");
    return () => {
      section?.removeAttribute("aria-busy");
      // The new list can change the page's height, so settle the list back in view.
      section?.scrollIntoView({ behavior: motionReduced() ? "auto" : "smooth", block: "start" });
    };
  }, [pending, target]);

  return (
    <Link
      href={href}
      className={className}
      aria-current={current ? "true" : undefined}
      data-pending={pending ? "" : undefined}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        document.getElementById(target)?.scrollIntoView({ behavior: motionReduced() ? "auto" : "smooth", block: "start" });
        start(() => router.push(href, { scroll: false }));
      }}
    >
      {children}
    </Link>
  );
}
