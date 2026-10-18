"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";

// The site footer. Every link goes to a page or section that exists; nothing points
// to "#". Signed-out visitors (the login page) only see the brand and the bottom row,
// because every other page needs a sign-in.

type FooterLink = { label: string; href?: string; assistant?: boolean };

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Guided decisions", href: "/requests/new/wizard" },
      { label: "Paste a message", href: "/requests/new/intake" },
      { label: "AI assistant", assistant: true },
      { label: "Knowledge Hub", href: "/knowledge" },
      { label: "Owner approvals", href: "/owner" },
    ],
  },
  {
    title: "For your team",
    links: [
      { label: "Business owners", href: "/owner" },
      { label: "Admin teams", href: "/requests" },
      { label: "Today's queue", href: "/" },
    ],
  },
  {
    title: "Rules and support",
    links: [
      { label: "Owner rules", href: "/knowledge#rules" },
      { label: "Staff procedures", href: "/knowledge#procedures" },
      { label: "Coverage and gaps", href: "/coverage" },
      { label: "Integrations", href: "/coverage#integrations" },
    ],
  },
];

export function SiteFooter({ signedIn }: { signedIn: boolean }) {
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
              <svg className="footer-compass" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
                <circle cx="24" cy="24" r="17" fill="#0066cc" />
                <g className="footer-needle">
                  <path d="M24 9l5 15-5 15-5-15z" fill="#ffffff" />
                  <path d="M24 9l5 15h-10z" fill="#7cc8ff" />
                </g>
                <circle cx="24" cy="24" r="2.4" fill="#0066cc" />
              </svg>
              <span>Tutor Compass</span>
            </Link>
            <p className="footer-tagline">A clearer direction for your tutoring business.</p>
            <p className="footer-about">Bring your business knowledge together, support your team and keep everyday decisions moving, with you in control.</p>
          </div>

          {signedIn &&
            GROUPS.map((g) => (
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
