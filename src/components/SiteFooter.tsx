"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Logo } from "./Logo";
import { motionReduced } from "@/lib/a11y/motion";
import { useI18n } from "@/components/i18n/I18nProvider";

// The site footer, shown to signed-in staff. Every link goes to a page or section that
// exists; nothing points to "#".

type FooterLink = { label: FooterKey; href?: string; assistant?: boolean };
type FooterKey = `shell.footer.${"guidedWizard" | "quickCapture" | "compassAi" | "schedule" | "knowledgeHub" | "approvalAlley" | "businessOwners" | "adminTeams" | "dashboard" | "ownerRules" | "staffProcedures" | "coverage" | "integrations" | "product" | "forYourTeam" | "rulesSupport"}`;

const GROUPS: { title: FooterKey; links: FooterLink[] }[] = [
  {
    title: "shell.footer.product",
    links: [
      { label: "shell.footer.guidedWizard", href: "/requests/new/wizard" },
      { label: "shell.footer.quickCapture", href: "/requests/new/intake" },
      { label: "shell.footer.compassAi", assistant: true },
      { label: "shell.footer.schedule", href: "/schedule" },
      { label: "shell.footer.knowledgeHub", href: "/knowledge" },
      { label: "shell.footer.approvalAlley", href: "/owner" },
    ],
  },
  {
    title: "shell.footer.forYourTeam",
    links: [
      { label: "shell.footer.businessOwners", href: "/owner" },
      { label: "shell.footer.adminTeams", href: "/requests" },
      { label: "shell.footer.dashboard", href: "/" },
    ],
  },
  {
    title: "shell.footer.rulesSupport",
    links: [
      { label: "shell.footer.ownerRules", href: "/knowledge#rules" },
      { label: "shell.footer.staffProcedures", href: "/knowledge#procedures" },
      { label: "shell.footer.coverage", href: "/coverage" },
      { label: "shell.footer.integrations", href: "/coverage#integrations" },
    ],
  },
];

export function SiteFooter() {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { t } = useI18n();

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
              <Logo />
            </Link>
            <p className="footer-tagline">{t("shell.footer.tagline")}</p>
            <p className="footer-about">{t("shell.footer.about")}</p>
          </div>

          {GROUPS.map((g) => (
              <nav key={g.title} className="footer-col" aria-label={t(g.title)} data-compass-avoid>
                <h2>{t(g.title)}</h2>
                <ul>
                  {g.links.map((l) => (
                    <li key={l.label}>
                      {l.assistant ? (
                        <button type="button" className="footer-link" onClick={() => window.dispatchEvent(new Event("compass:open"))}>
                          {t(l.label)}
                        </button>
                      ) : (
                        <Link className="footer-link" href={l.href!}>{t(l.label)}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
        </div>

        <div className="footer-bottom" data-compass-avoid>
          <p>
            {t("shell.footer.copyright", { year: new Date().getFullYear() })}
            <span className="footer-legal"> <Link href="/privacy">{t("shell.footer.privacy")}</Link> · <Link href="/terms">{t("shell.footer.terms")}</Link> · <Link href="/support">{t("shell.footer.support")}</Link></span>
          </p>
          <p className="footer-motto">{t("shell.footer.motto")}</p>
        </div>
      </div>
    </footer>
  );
}
