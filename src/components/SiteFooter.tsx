"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Logo } from "./Logo";

// The site footer, shown to signed-in staff. Every link goes to a page or section that
// exists; nothing points to "#".

type FooterLink = { label: string; href?: string; assistant?: boolean };

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Guided Decisions", href: "/requests/new/wizard" },
      { label: "Paste a Message", href: "/requests/new/intake" },
      { label: "AI Assistant", assistant: true },
      { label: "Knowledge Hub", href: "/knowledge" },
      { label: "Owner Approvals", href: "/owner" },
    ],
  },
  {
    title: "For Your Team",
    links: [
      { label: "Business Owners", href: "/owner" },
      { label: "Admin Teams", href: "/requests" },
      { label: "Today's Queue", href: "/" },
    ],
  },
  {
    title: "Rules and Support",
    links: [
      { label: "Owner Rules", href: "/knowledge#rules" },
      { label: "Staff Procedures", href: "/knowledge#procedures" },
      { label: "Coverage and Gaps", href: "/coverage" },
      { label: "Integrations", href: "/coverage#integrations" },
    ],
  },
];

export function SiteFooter() {
  const ref = useRef<HTMLElement>(null);

  // Fade in once when the footer first scrolls into view. Without scripts, or with
  // reduced motion, the footer is simply shown.
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight) {
      el.dataset.reveal = "in";
      return;
    }
    el.dataset.reveal = "pending";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.reveal = "in";
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <footer ref={ref} className="site-footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" className="footer-logo">
              <Logo variant="light" />
            </Link>
            <p className="footer-tagline">A clearer direction for your tutoring business.</p>
            <p className="footer-about">Bring your business knowledge together, support your team and keep everyday decisions moving, with you in control.</p>
          </div>

          {GROUPS.map((g) => (
              <nav key={g.title} className="footer-col" aria-label={g.title}>
                <h2>{g.title}</h2>
                <ul>
                  {g.links.map((l) => (
                    <li key={l.label}>
                      {l.assistant ? (
                        <button type="button" className="footer-link" onClick={() => window.dispatchEvent(new Event("compass:open"))}>
                          {l.label}
                        </button>
                      ) : (
                        <Link className="footer-link" href={l.href!}>{l.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} Tutor Compass. All rights reserved.</p>
          <p className="footer-motto">A clearer direction. Every day.</p>
        </div>
      </div>
    </footer>
  );
}
