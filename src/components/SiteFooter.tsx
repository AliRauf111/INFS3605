"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Logo } from "./Logo";
import { motionReduced } from "@/lib/a11y/motion";

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

  // A soft entrance each time the footer comes into view: the brand, then the link
  // columns, then the copyright row fade up (see globals.css), the compass needle settles
  // and the Compass companion waves. It plays when about a fifth of the footer is showing
  // and resets only once the footer has left the screen completely, so small scrolls near
  // the edge never restart it. The footer element itself never moves, so it is what we
  // watch. The layout keeps this component mounted between pages; each page change starts
  // a fresh observer. Without scripts or with reduced motion the footer is simply shown.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    delete el.dataset.reveal;
    if (motionReduced() || !("IntersectionObserver" in window)) return;
    // Already on screen as the page opens: leave it showing rather than hide and replay it.
    let shown = el.getBoundingClientRect().top < window.innerHeight;
    if (!shown) el.dataset.reveal = "pending";
    const play = () => {
      if (shown) return;
      shown = true;
      el.dataset.reveal = "in";
      window.dispatchEvent(new Event("compass:footer-seen"));
    };
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e.isIntersecting) {
          // Completely out of view: hide the content again, ready for the next entrance.
          // Nothing is visible at this point, so the reset can't be seen.
          shown = false;
          el.dataset.reveal = "pending";
        } else if (e.intersectionRatio >= 0.18) {
          play();
        }
      },
      { threshold: [0, 0.18] },
    );
    io.observe(el);
    // Tabbing into the footer shows it straight away, so focus never lands on hidden links.
    el.addEventListener("focusin", play);
    return () => {
      io.disconnect();
      el.removeEventListener("focusin", play);
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
