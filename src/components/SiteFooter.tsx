"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Logo } from "./Logo";

// The site footer, shown to signed-in staff. Every link goes to a page or section that
// exists; nothing points to "#".

type FooterLink = { label: string; href?: string; assistant?: boolean };

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Guided Wizard", href: "/requests/new/wizard" },
      { label: "Quick Capture", href: "/requests/new/intake" },
      { label: "Compass AI", assistant: true },
      { label: "Knowledge Hub", href: "/knowledge" },
      { label: "Approval Alley", href: "/owner" },
    ],
  },
  {
    title: "For Your Team",
    links: [
      { label: "Business Owners", href: "/owner" },
      { label: "Admin Teams", href: "/requests" },
      { label: "Dashboard", href: "/" },
    ],
  },
  {
    title: "Rules and Support",
    links: [
      { label: "Owner Rules", href: "/knowledge#rules" },
      { label: "Staff Procedures", href: "/knowledge#procedures" },
      { label: "Coverage", href: "/coverage" },
      { label: "Integrations", href: "/coverage#integrations" },
    ],
  },
];

export function SiteFooter() {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // A soft entrance, once per page visit: when about a fifth of the footer scrolls into
  // view, the brand, then the link columns, then the copyright row fade up (see
  // globals.css), the compass needle settles and the Compass companion waves once.
  // Without scripts, with reduced motion, or if the footer is already on screen when the
  // page opens, the footer is simply shown.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    delete el.dataset.reveal;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.dataset.reveal = "pending";
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      io.disconnect();
      el.removeEventListener("focusin", reveal);
      el.dataset.reveal = "in";
      window.dispatchEvent(new Event("compass:footer-seen"));
    };
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) reveal(); }, { threshold: 0.18 });
    io.observe(el);
    // Tabbing into the footer shows it straight away, so focus never lands on hidden links.
    el.addEventListener("focusin", reveal);
    return () => {
      io.disconnect();
      el.removeEventListener("focusin", reveal);
    };
  }, [pathname]);

  return (
    <footer ref={ref} className="site-footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand" data-compass-avoid>
            <Link href="/" className="footer-logo">
              <Logo variant="light" />
            </Link>
            <p className="footer-tagline">A clearer direction for your tutoring business.</p>
            <p className="footer-about">Bring your business knowledge together, support your team and keep everyday decisions moving, with you in control.</p>
          </div>

          {GROUPS.map((g) => (
              <nav key={g.title} className="footer-col" aria-label={g.title} data-compass-avoid>
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

        <div className="footer-bottom" data-compass-avoid>
          <p>
            © {new Date().getFullYear()} Tutor Compass. All rights reserved.
            <span className="footer-legal"> <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/support">Support</Link></span>
          </p>
          <p className="footer-motto">A clearer direction. Every day.</p>
        </div>
      </div>
    </footer>
  );
}
