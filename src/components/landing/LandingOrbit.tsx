"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AuthPanel, AUTH_MODE_EVENT, type Message, type Mode } from "@/app/login/AuthPanel";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { LogoMark } from "@/components/Logo";
import { CompassOrb, type CompassOrbHandle } from "./CompassOrb";
import { ORBIT_REQUESTS, OUTCOME_LABELS, type OrbitRequest } from "./orbit-requests";
import { useFitToScreen } from "./use-fit-to-screen";

// The landing and sign-in page in the "Compass Decision Orbit" design. Left: the headline
// and the two main actions. Centre: Compass AI with four example requests around it; picking
// one shows how Compass would handle it under the owner's rules. Right: the real sign-in
// panel (the same AuthPanel and Supabase routes as /login). Below: the benefit cards.
//
// Nothing here is live data. The four requests are fictional examples that follow the
// demo rule set, so the outcome shown is the outcome the app would reach.

type Props = {
  initialMode: Mode;
  message: Message;
  next: string;
  configured: boolean;
  signedIn: boolean;
  year: number;
};

const GREETING = { title: "Hi! I'm Compass AI", text: "I check requests against your rules. You make the big calls." };

// Card centres, in the stage's 1000 x 720 drawing space.
const STAGE = { w: 1000, h: 800 };
const CARD_AT: Record<OrbitRequest["id"], { x: number; y: number; tilt: number }> = {
  lesson_change: { x: 182, y: 285, tilt: 5 },
  payment_extension: { x: 818, y: 218, tilt: 6 },
  tutor_absence: { x: 178, y: 560, tilt: 5 },
  owner_approval: { x: 822, y: 538, tilt: -7 },
};

/** Curved links from the inner edge of each card to the rim of Compass's head. */
const LINKS: Record<OrbitRequest["id"], string> = {
  lesson_change: "M222 330 Q254 452 362 446",
  tutor_absence: "M282 520 Q334 500 390 484",
  payment_extension: "M776 258 Q750 338 676 352",
  owner_approval: "M728 500 Q690 470 634 462",
};

function scrollToAuth(focus?: string) {
  const panel = document.getElementById("lp-auth");
  if (!panel) return;
  const reduce = document.documentElement.dataset.motion === "reduce" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  if (focus) window.setTimeout(() => document.getElementById(focus)?.focus({ preventScroll: true }), reduce ? 0 : 450);
}

export function LandingOrbit({ initialMode, message, next: initialNext, configured, signedIn, year }: Props) {
  const orb = useRef<CompassOrbHandle>(null);
  const page = useRef<HTMLDivElement>(null);
  useFitToScreen(page);
  const [selected, setSelected] = useState<OrbitRequest | null>(null);
  const [bubble, setBubble] = useState(GREETING);
  const [bubbleKey, setBubbleKey] = useState(0);
  const [greeted, setGreeted] = useState(false);

  // The greeting appears a moment after the page loads, like Compass saying hello.
  useEffect(() => {
    const t = window.setTimeout(() => setGreeted(true), 500);
    return () => window.clearTimeout(t);
  }, []);

  const say = (title: string, text: string) => {
    setBubble({ title, text });
    setBubbleKey((k) => k + 1);
  };

  const pick = (r: OrbitRequest, el: HTMLElement) => {
    if (selected?.id === r.id) return clear();
    setSelected(r);
    say(r.title, r.bubble);
    const box = el.getBoundingClientRect();
    orb.current?.lookAt(box.left + box.width / 2, box.top + box.height / 2);
    orb.current?.react("focus");
  };

  const clear = () => {
    setSelected(null);
    say(GREETING.title, GREETING.text);
  };

  const openDemo = () => {
    const details = document.getElementById("lp-demo-access") as HTMLDetailsElement | null;
    if (details) details.open = true;
  };

  const tryDemo = () => {
    orb.current?.react("cheer");
    say("Let's go!", "Sign in with one of the demo accounts and I'll show you around.");
    window.dispatchEvent(new CustomEvent<Mode>(AUTH_MODE_EVENT, { detail: "signin" }));
    window.setTimeout(() => {
      openDemo();
      scrollToAuth("email");
    }, 60);
  };

  const createAccount = () => {
    window.dispatchEvent(new CustomEvent<Mode>(AUTH_MODE_EVENT, { detail: "signup" }));
    window.setTimeout(() => scrollToAuth("su-name"), 60);
  };

  return (
    <div className="lp" ref={page}>
      <div className="lp-bg" aria-hidden="true" />
      <header className="lp-head">
        <Link href="/landing-preview" className="lp-brand" aria-label="Tutor Compass home">
          <LogoMark className="lp-logo-mark" />
          <span className="lp-wordmark" aria-hidden="true">
            <span><b>tutor</b>compass</span>
            <small>STUDIO</small>
          </span>
        </Link>
        <nav className="lp-nav" aria-label="Page sections">
          <a href="#orbit">Compass AI</a>
          <a href="#benefits">Why Tutor Compass</a>
        </nav>
        <div className="lp-head-actions">
          <LanguageMenu className="lp-lang" />
          <Link href="/support" className="lp-support">Contact support</Link>
          {signedIn ? (
            <Link href="/" className="lp-pill lp-pill-dark">Go to your dashboard</Link>
          ) : (
            <>
              <button type="button" className="lp-pill lp-pill-light lp-head-demo" onClick={tryDemo}>
                <PlayIcon />Try the demo
              </button>
              <button type="button" className="lp-pill lp-pill-dark lp-head-create" onClick={createAccount}>Create account</button>
            </>
          )}
        </div>
      </header>

      <main className="lp-grid">
        <div className="lp-hero">
          <div className="lp-intro">
            <p className="lp-eyebrow">Compass Decision Orbit</p>
            <h1 id="lp-heading">
              Your tutoring decisions, handled by <span className="lp-underline">Compass AI.</span>
            </h1>
            <p className="lp-lead">
              <span>Less admin. Smarter decisions. More time for what matters.</span>{" "}
              <span>Let Compass AI handle the routine while you stay in control.</span>
            </p>
          </div>
          <div className="lp-cta">
            <div className="lp-cta-buttons">
              {signedIn ? (
                <Link href="/" className="lp-btn lp-btn-dark">Go to your dashboard <ArrowIcon /></Link>
              ) : (
                <>
                  <button type="button" className="lp-btn lp-btn-dark" onClick={createAccount}>Create your account <ArrowIcon /></button>
                  <button type="button" className="lp-btn lp-btn-light" onClick={tryDemo}><PlayIcon />Try the demo</button>
                </>
              )}
            </div>
            <ul className="lp-checks">
              <li><CheckIcon />Checks every request against your rules</li>
              <li><CheckIcon />You approve the big decisions</li>
              <li><CheckIcon />Every outcome logged</li>
            </ul>
          </div>
        </div>

        <section className="lp-orbit" id="orbit" aria-labelledby="lp-orbit-heading">
          <h2 id="lp-orbit-heading" className="sr-only">See how Compass AI handles a request</h2>
          <div className="lp-stage">
            <svg className="lp-paths" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id="lp-path-grad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#c8b3ff" stopOpacity="0.2" />
                  <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.95" />
                  <stop offset="1" stopColor="#c8b3ff" stopOpacity="0.2" />
                </linearGradient>
                <filter id="lp-path-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" />
                </filter>
              </defs>
              {/* Large orbital paths that tie the four requests together */}
              <ellipse className="lp-orbit-line" cx="500" cy="384" rx="392" ry="160" transform="rotate(-9 500 384)" />
              <ellipse className="lp-orbit-line lp-orbit-line-2" cx="500" cy="372" rx="350" ry="232" transform="rotate(14 500 372)" />
              <circle className="lp-orbit-bead" cx="128" cy="436" r="7" />
              <circle className="lp-orbit-bead" cx="770" cy="300" r="5" />
              <circle className="lp-orbit-bead" cx="830" cy="452" r="8" />

              {/* Platform under Compass */}
              <g className="lp-platform">
                <ellipse cx="500" cy="700" rx="260" ry="46" />
                <ellipse cx="500" cy="700" rx="196" ry="33" />
                <ellipse cx="500" cy="700" rx="130" ry="22" />
                <path d="M450 600 L550 600 L600 700 L400 700Z" className="lp-beam" />
              </g>

            </svg>

            <div className={`lp-bubble${greeted ? " in" : ""}`} aria-live="polite">
              <p key={bubbleKey} className="lp-bubble-text">
                <strong>{bubble.title}</strong> <SparkIcon />
                <span>{bubble.text}</span>
              </p>
            </div>

            <div className={`lp-orb-wrap${selected ? " linked" : ""}`}>
              <CompassOrb ref={orb} label="Compass AI. Press to say hello." onPoke={() => say("Hello again!", selected ? selected.bubble : "Pick a request and I'll show you how I'd handle it.")} />
            </div>

            <svg className="lp-paths lp-links" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} aria-hidden="true" focusable="false">
                {/* The link from the picked request to Compass */}
                {ORBIT_REQUESTS.map((r) => (
                  <g key={r.id} className={`lp-link${selected?.id === r.id ? " on" : ""}`}>
                    <path d={LINKS[r.id]} pathLength={1} className="lp-link-glow" filter="url(#lp-path-glow)" />
                    <path d={LINKS[r.id]} pathLength={1} className="lp-link-line" />
                    <path d={LINKS[r.id]} pathLength={1} className="lp-link-pulse" />
                  </g>
                ))}
            </svg>

            <div className="lp-engine" aria-hidden="true">
              <span className="lp-engine-top"><SparkIcon />Compass AI</span>
              <span className="lp-engine-sub">The decision engine</span>
            </div>
          </div>

          <ul className="lp-requests" aria-label="Example requests">
            {ORBIT_REQUESTS.map((r) => {
              const at = CARD_AT[r.id];
              return (
                <li
                  key={r.id}
                  className={`lp-req lp-req-${r.id}`}
                  style={{ "--x": `${(at.x / STAGE.w) * 100}%`, "--y": `${(at.y / STAGE.h) * 100}%`, "--tilt": `${at.tilt}deg` } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className={`lp-req-btn${selected?.id === r.id ? " on" : ""}`}
                    aria-pressed={selected?.id === r.id}
                    onClick={(e) => pick(r, e.currentTarget)}
                  >
                    <span className={`lp-req-icon lp-ic-${r.id}`}><RequestIcon id={r.id} /></span>
                    <span className="lp-req-text">
                      <strong>{r.title}</strong>
                      <span>{r.summary}</span>
                    </span>
                    <span className={`lp-dot ${r.signal}`} aria-hidden="true" />
                    <span className="sr-only">. {OUTCOME_LABELS[r.outcome]}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="lp-decision">
            <p className="lp-dec-hint"><SparkIcon />Pick a request to see how Compass AI would handle it.</p>
          </div>
        </section>

        <aside className="lp-auth" id="lp-auth" aria-labelledby="signin-heading">
          {!configured && (
            <div className="notice error" role="alert">
              Sign-in isn&apos;t set up on this copy of the app yet, so the buttons below won&apos;t work until it is.
            </div>
          )}
          {signedIn && (
            <div className="notice info" role="status">
              You&apos;re already signed in. <Link href="/">Go to your dashboard</Link>
            </div>
          )}
          <AuthPanel
            next={initialNext}
            initialMode={initialMode}
            message={message}
            intro={{ title: "Welcome to TutorCompass", sub: "Sign in to your account or create a new one." }}
            demo={
              <details className="landing-demo lp-demo" id="lp-demo-access">
                <summary>Trying the demo?</summary>
                <p>
                  Two fictional demo accounts exist: an administrator (Sarah) and the owner (Alex). Whoever set up this copy of
                  the app chose their passwords, so ask them for the details. Passwords are not stored in the code.
                </p>
              </details>
            }
          />
        </aside>

        <section className="lp-benefits" id="benefits" aria-label="Why Tutor Compass">
          <Benefit tone="lavender" title="Faster Decisions" text="Turn requests into clear next steps." icon={<SparkIcon />} />
          <Benefit tone="yellow" title="Your Rules, Always" text="Compass AI follows the boundaries you set." icon={<LayersIcon />} />
          <Benefit tone="blue" title="Less Admin" text="Reduce repetitive work and unnecessary back-and-forth." icon={<PeopleIcon />} />
          <Benefit tone="mint" title="More Control" text="Review exceptions and approve important decisions." icon={<ShieldIcon />} />
        </section>

      </main>

      <footer className="lp-foot">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/support">Support</Link>
        <span>© {year} Tutor Compass</span>
      </footer>
    </div>
  );
}

function Benefit({ tone, title, text, icon }: { tone: string; title: string; text: string; icon: React.ReactNode }) {
  return (
    <div className={`lp-benefit ${tone}`}>
      <span className="lp-benefit-icon">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </div>
  );
}

function RequestIcon({ id }: { id: OrbitRequest["id"] }) {
  if (id === "lesson_change") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4m8-4v4M3.5 10.5h17M8 14.5h1.5m5 0H16" /></svg>;
  if (id === "payment_extension") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="2.6" /><path d="M2.5 10h19M6.5 15h4" /></svg>;
  if (id === "tutor_absence") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M5 20.5c.6-3.7 3.4-6 7-6s6.4 2.3 7 6" /></svg>;
  return <ShieldIcon />;
}

const ArrowIcon = () => <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>;
const PlayIcon = () => <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7Z" /></svg>;
const CheckIcon = () => <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const SparkIcon = () => <svg className="lp-i lp-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5Z" /><path d="M19 15.5c.25 1.9 1.1 2.75 3 3-1.9.25-2.75 1.1-3 3-.25-1.9-1.1-2.75-3-3 1.9-.25 2.75-1.1 3-3Z" /></svg>;
const LayersIcon = () => <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" /><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" /></svg>;
const PeopleIcon = () => <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.4" /><path d="M2.8 20c.5-3.5 2.9-5.6 6.2-5.6s5.7 2.1 6.2 5.6" /><path d="M15.5 4.9a3.3 3.3 0 0 1 0 6.3M17.6 14.6c2 .7 3.3 2.6 3.6 5.4" /></svg>;
const ShieldIcon = () => <svg className="lp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 19.5 5.6v6c0 4.6-3.1 8-7.5 9.8-4.4-1.8-7.5-5.2-7.5-9.8v-6L12 2.8Z" /><path d="m8.8 12 2.2 2.2 4.3-4.4" /></svg>;
