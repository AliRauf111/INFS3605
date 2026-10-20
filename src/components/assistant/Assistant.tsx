"use client";
import "./assistant.css";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EMPTY_STATE, type AssistantState, type Block, type Choice, type Command, type TaskField, type TurnResponse } from "@/lib/assistant/logic";
import { SHORTCUTS, type ShortcutId } from "@/lib/assistant/shortcuts";
import { CompassAvatar, type AvatarState } from "./CompassAvatar";
import { AssistantMessage, type ActionState, type ChatItem } from "./Messages";
import { useSpeech, useVoice } from "./useVoice";
import { motionReduced } from "@/lib/a11y/motion";

// Compass AI: the floating assistant on every signed-in page. This component owns the
// panel, the conversation and the voice controls. The server decides what to ask and
// runs the owner's rules; nothing here can change a decision.

type SendInput = {
  message?: string;
  answer?: { field: TaskField; value: string };
  start?: ShortcutId;
  command?: Command;
};
type Stored = { items: ChatItem[]; state: AssistantState; sessionKey: string; readAloud: boolean; draft: string };

const STORE = "compass.chat.v2";
const GREETED = "compass.greeted";

const uid = () => crypto.randomUUID();

/** What the welcome screen says about AI. It only changes with the server's AI setting. */
function welcomeMode(aiLive: boolean): string {
  return aiLive
    ? "Live AI is on. It only reads your messages and words summaries. Records, permissions and the owner's rules decide everything. The four shortcuts use no AI."
    : "Demo mode: no AI service is connected. Keyword rules, current records and the owner's rules run everything, and every workflow works in full.";
}

function spokenText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "text":
        case "notice":
          return b.text;
        case "decision":
          return `${b.title}. ${b.explanation}`;
        case "policy":
          return b.answer;
        case "review":
          return `Review of ${b.request.reference}. ${b.request.statusLabel}. ${b.readiness.ready ? "Ready for a decision." : "Not ready for a clean decision."}`;
        case "proposal":
          return `${b.proposal.preview.title}. Prepared, not saved. Awaiting your confirmation.`;
        case "draft":
          return `${b.title} prepared. Not saved and not sent.`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join(" ");
}

const Icon = {
  mic: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zm-6 9a6 6 0 0 0 12 0M12 18v3" />,
  send: <path d="M5 12h12M13 6l6 6-6 6" />,
  clip: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  minus: <path d="M6 12h12" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  keyboard: <path d="M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10" />,
  speaker: <path d="M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6" />,
};
function Svg({ name, label }: { name: keyof typeof Icon; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={name === "stop" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={name === "more" ? 3.2 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {Icon[name]}
    </svg>
  );
}

const WAVE = Array.from({ length: 28 }, (_, i) => i);

export function Assistant({ firstName, aiLive }: { firstName: string; aiLive: boolean }) {
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [conv, setConv] = useState<AssistantState>(EMPTY_STATE);
  const [sessionKey, setSessionKey] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const [dodge, setDodge] = useState<"" | "compact" | "tucked">("");
  const [available, setAvailable] = useState(true);
  const [mood, setMood] = useState<AvatarState | null>(null);
  const [announce, setAnnounce] = useState("");
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [paused, setPaused] = useState(false);
  const [modeNote, setModeNote] = useState(() => welcomeMode(aiLive));

  const abortRef = useRef<AbortController | null>(null);
  const lastSend = useRef<{ input: SendInput; label: string } | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const voice = useVoice();
  const speech = useSpeech();

  // Restore this tab's conversation, and greet once per session. Reloading the page
  // starts a fresh, empty chat; only the read-aloud setting is kept.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE);
      const saved = raw ? (JSON.parse(raw) as Stored) : null;
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const fresh = nav?.type === "reload";
      setItems(fresh ? [] : saved?.items ?? []);
      setConv(fresh ? EMPTY_STATE : saved?.state ?? EMPTY_STATE);
      setSessionKey((!fresh && saved?.sessionKey) || uid());
      setReadAloud(Boolean(saved?.readAloud));
      setDraft(fresh ? "" : saved?.draft ?? "");
    } catch {
      setSessionKey(uid());
    }
    setHydrated(true);
    let t1: ReturnType<typeof setTimeout> | undefined;
    let t2: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!sessionStorage.getItem(GREETED)) {
        // Marked as greeted only once it shows, so a remount can't swallow it.
        t1 = setTimeout(() => {
          try { sessionStorage.setItem(GREETED, "1"); } catch { /* ignore */ }
          setGreeting(true);
        }, 1200);
        t2 = setTimeout(() => setGreeting(false), 9000);
      }
    } catch { /* storage blocked: no greeting */ }
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ items: items.slice(-60), state: conv, sessionKey, readAloud, draft } satisfies Stored));
    } catch { /* storage full or blocked */ }
  }, [hydrated, items, conv, sessionKey, readAloud, draft]);

  // Pause decorative animation when the tab is hidden.
  useEffect(() => {
    const f = () => setPaused(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  // The microphone is only ever on while voice mode is open. Closing or minimising the
  // panel, or leaving voice mode any other way, releases it.
  const voiceRelease = voice.release;
  const voiceActive = voice.active;
  useEffect(() => {
    if ((!open || mode !== "voice") && voiceActive) voiceRelease();
  }, [open, mode, voiceActive, voiceRelease]);

  // Keep the panel above the on-screen keyboard on phones.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const f = () => document.documentElement.style.setProperty("--compass-vh", `${vv.height}px`);
    f();
    vv.addEventListener("resize", f);
    return () => vv.removeEventListener("resize", f);
  }, []);

  const flash = useCallback((m: AvatarState, ms = 1100) => {
    if (moodTimer.current) clearTimeout(moodTimer.current);
    setMood(m);
    moodTimer.current = setTimeout(() => setMood(null), ms);
  }, []);

  // A small hello each time the footer comes into view: one wave, then back to rest.
  // Skipped with reduced motion, while the panel is open or while Compass is busy.
  const quietRef = useRef(true);
  quietRef.current = !open && !busy && voice.phase === "idle" && !speech.speaking;
  useEffect(() => {
    const onSeen = () => {
      if (!quietRef.current || motionReduced()) return;
      flash("wave", 1300);
    };
    window.addEventListener("compass:footer-seen", onSeen);
    return () => window.removeEventListener("compass:footer-seen", onSeen);
  }, [flash]);

  const scrollToEnd = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: motionReduced() ? "auto" : "smooth" });
    setShowNew(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (nearBottom.current) requestAnimationFrame(scrollToEnd);
    else setShowNew(true);
  }, [items.length, busy, open, scrollToEnd]);

  const openPanel = () => {
    setOpen(true);
    setGreeting(false);
    flash("wave", 1000);
    nearBottom.current = true;
    setTimeout(() => {
      if (mode === "chat") inputRef.current?.focus();
      scrollToEnd();
    }, 60);
  };
  // Pages mark busy areas, like the Saved requests table, with data-compass-avoid. While
  // the launcher would sit on top of one, it hides its label and greeting, and if the
  // robot itself would still cover a control it tucks in at the edge of the screen.
  const launcherBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const check = () => {
      frame = 0;
      const box = launcherBoxRef.current;
      const avatar = launcherRef.current;
      const zones = [...document.querySelectorAll<HTMLElement>("[data-compass-avoid]")].map((z) => z.getBoundingClientRect());
      if (!box || !avatar || zones.length === 0) return setDodge("");
      const shift = new DOMMatrixReadOnly(getComputedStyle(box).transform === "none" ? undefined : getComputedStyle(box).transform).m41;
      const home = (r: DOMRect) => new DOMRect(r.x - shift, r.y, r.width, r.height);
      const whole = home(box.getBoundingClientRect());
      // The greeting bubble sits above the launcher, so count that space too.
      const reach = new DOMRect(whole.x, whole.y - 90, whole.width, whole.height + 90);
      const robot = home(avatar.getBoundingClientRect());
      if (zones.some((z) => overlaps(robot, z))) setDodge("tucked");
      else if (zones.some((z) => overlaps(reach, z))) setDodge("compact");
      else setDodge("");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // Other parts of the page (the footer link, for example) open the panel with this event.
  const openRef = useRef(openPanel);
  openRef.current = openPanel;
  useEffect(() => {
    const onOpen = () => openRef.current();
    window.addEventListener("compass:open", onOpen);
    return () => window.removeEventListener("compass:open", onOpen);
  }, []);
  const minimise = () => {
    voice.release();
    setOpen(false);
    setMenuOpen(false);
    speech.cancel();
    setTimeout(() => launcherRef.current?.focus(), 0);
  };
  const closePanel = () => {
    minimise();
    setMode("chat");
  };

  const send = useCallback(async (input: SendInput, label: string) => {
    if (busy) return;
    const userItem: ChatItem = { id: uid(), role: "user", text: label };
    setItems((xs) => [...xs, userItem]);
    setBusy(true);
    setAttachNote(null);
    nearBottom.current = true;
    lastSend.current = { input, label };
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey, state: conv, ...input }),
        signal: ctrl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `Compass hit a problem (${res.status}).`);
      const turn = json as TurnResponse;
      setItems((xs) => [...xs, { id: uid(), role: "assistant", blocks: turn.blocks, steps: turn.steps, modeNote: turn.modeNote }]);
      setConv(turn.state);
      setModeNote(turn.modeNote);
      setAvailable(true);
      flash(turn.mood === "success" ? "success" : turn.mood === "clarify" ? "clarify" : turn.mood === "error" ? "error" : "replying");
      const spoken = spokenText(turn.blocks);
      setAnnounce(`Compass: ${spoken}`);
      if (readAloud) speech.speak(spoken);
    } catch (e) {
      const stopped = e instanceof DOMException && e.name === "AbortError";
      setItems((xs) => [
        ...xs.filter((x) => x.id !== userItem.id),
        {
          id: uid(), role: "assistant", error: !stopped,
          text: stopped
            ? "Stopped. Your message is back in the box if you want to change it."
            : `${e instanceof Error ? e.message : "Compass couldn't reply."} Your message is back in the box, so nothing is lost.`,
        },
      ]);
      if (input.message) setDraft(input.message);
      if (!stopped) {
        setAvailable(false);
        flash("error", 2500);
      }
      setAnnounce(stopped ? "Stopped." : "Compass couldn't reply.");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, sessionKey, conv, flash, readAloud, speech]);

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void send({ message: text }, text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitDraft();
    }
  };

  const onPick = (field: TaskField, c: Choice) => void send({ answer: { field, value: c.value } }, c.label);
  const onCommand = (command: Command, label: string) => void send({ command }, label);

  const onAction = (itemId: string, index: number, next: ActionState) => {
    setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, actions: { ...x.actions, [index]: next } } : x)));
    if (next.card?.p?.stage === "done") flash("success");
  };

  const newConversation = () => {
    setMenuOpen(false);
    if (items.length && !window.confirm("Start a new conversation? This clears the current one.")) return;
    abortRef.current?.abort();
    speech.cancel();
    setItems([]);
    setConv(EMPTY_STATE);
    setSessionKey(uid());
    setDraft("");
    setModeNote(welcomeMode(aiLive));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!(file.type === "text/plain" || /\.txt$/i.test(file.name))) {
      setAttachNote("Only plain text (.txt) files can be read. Paste anything else into the message box.");
      return;
    }
    if (file.size > 20_000) {
      setAttachNote("That file is too long. Paste the part that matters instead.");
      return;
    }
    const text = (await file.text()).trim().slice(0, 3500);
    setDraft((d) => (d ? `${d}\n\n${text}` : text));
    setAttachNote(`Added the text from ${file.name}. Check it, then send.`);
    inputRef.current?.focus();
  };

  // Voice mode
  // Starts only from a press of a microphone button, never on its own.
  const enterVoice = () => {
    speech.cancel();
    voice.release();
    voice.setTranscript("");
    setMode("voice");
    setAnnounce("Voice mode.");
    voice.start();
  };
  const leaveVoice = (keepWords: boolean) => {
    voice.release();
    const t = voice.transcript.trim();
    if (keepWords && t) setDraft((d) => (d ? `${d} ${t}` : t));
    voice.setTranscript("");
    setMode("chat");
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  // Type Instead keeps the words heard so far. Cancel throws away this voice input only;
  // anything already typed in the message box stays.
  const backToTyping = () => leaveVoice(true);
  const cancelVoice = () => leaveVoice(false);
  const sendVoice = async () => {
    const t = voice.transcript.trim();
    if (!t || busy) return;
    // Give the microphone back before waiting for Compass to reply.
    voice.release();
    voice.setTranscript("");
    await send({ message: t }, t);
    setMode("chat");
  };

  const avatarState: AvatarState = !available && !busy
    ? "error"
    : voice.phase === "listening"
      ? "listening"
      : busy
        ? "thinking"
        : speech.speaking
          ? "speaking"
          : mood ?? "idle";

  const showWelcome = items.length === 0;

  const voiceLabel = busy
    ? "Processing…"
    : voice.phase === "requesting"
      ? "Waiting for Microphone Permission"
      : voice.phase === "listening"
        ? "Listening…"
        : voice.phase === "finishing"
          ? "Processing…"
          : voice.transcript.trim() && !voice.error
            ? "Microphone Off. Check your words, then send."
            : "Microphone Off";

  return (
    <div className="compass-root" data-paused={paused ? "true" : undefined}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>

      {greeting && !open && !dodge && (
        <div className="cl-greeting" role="status">
          <span>Hi {firstName}. Need a hand?</span>
          <button type="button" className="cl-greeting-close" aria-label="Dismiss greeting" onClick={() => setGreeting(false)}><Svg name="close" /></button>
        </div>
      )}

      <div ref={launcherBoxRef} className={`cl-launcher${open ? " is-open" : ""}${dodge && !open ? ` is-${dodge}` : ""}`}>
        <button type="button" className="cl-pill" onClick={open ? minimise : openPanel} aria-expanded={open} aria-controls="compass-panel" tabIndex={-1} aria-hidden="true">
          Ask Compass
        </button>
        <button
          ref={launcherRef}
          type="button"
          className="cl-avatar-btn"
          onClick={open ? minimise : openPanel}
          aria-expanded={open}
          aria-controls="compass-panel"
          aria-label={open ? "Minimise Compass AI" : `Ask Compass, the AI assistant${available ? "" : ". Having trouble connecting"}`}
        >
          <CompassAvatar state={open ? (busy ? "thinking" : "idle") : avatarState} size={72} />
          <span className={`cl-dot ${available ? "on" : "off"}`} aria-hidden="true" />
        </button>
      </div>

      <div
        id="compass-panel"
        className={`cp-panel${open ? " open" : ""} mode-${mode}`}
        role="dialog"
        aria-label="Compass AI assistant"
        aria-hidden={!open}
        inert={!open}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (menuOpen) setMenuOpen(false); else minimise(); } }}
      >
        <header className="cp-header">
          <CompassAvatar state={avatarState} size={40} />
          <div className="cp-title">
            <h2>Compass AI</h2>
            <p>{mode === "voice" ? "Voice mode" : "AI assistant"}</p>
          </div>
          {speech.speaking && (
            <button type="button" className="cp-icon-btn" onClick={speech.cancel} aria-label="Stop reading aloud"><Svg name="stop" /></button>
          )}
          <div className="cp-menu-wrap">
            <button type="button" className="cp-icon-btn" aria-label="Compass settings" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Svg name="more" /></button>
            {menuOpen && (
              <div className="cp-menu" role="menu">
                <button type="button" role="menuitem" onClick={newConversation}>New conversation</button>
                <button type="button" role="menuitemcheckbox" aria-checked={readAloud} disabled={!speech.available} onClick={() => { setReadAloud((v) => !v); speech.cancel(); }}>
                  <span className={`cp-check${readAloud ? " on" : ""}`} aria-hidden="true">{readAloud ? "✓" : ""}</span> Read replies aloud
                </button>
                <p className="cp-menu-note">{modeNote}</p>
              </div>
            )}
          </div>
          <button type="button" className="cp-icon-btn" onClick={minimise} aria-label="Minimise Compass AI"><Svg name="minus" /></button>
          <button type="button" className="cp-icon-btn" onClick={closePanel} aria-label="Close Compass AI"><Svg name="close" /></button>
        </header>

        {mode === "chat" ? (
          <>
            <div
              className="cp-list"
              ref={listRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                if (nearBottom.current) setShowNew(false);
              }}
            >
              {showWelcome && (
                <div className="cp-welcome">
                  <div className="cp-msg assistant">
                    <CompassAvatar size={28} className="cp-msg-avatar" />
                    <div className="cp-msg-body"><div className="cp-bubble">Hi {firstName}. What would you like to sort out?</div></div>
                  </div>
                  <nav className="cp-shortcuts" aria-label="Shortcuts">
                    {SHORTCUTS.filter((x) => x.layout === "wide").map((x) => (
                      <button key={x.id} type="button" className="cp-shortcut wide" data-shortcut={x.id} aria-describedby={`cp-hint-${x.id}`} disabled={busy} onClick={() => void send({ start: x.id }, x.label)}>
                        <span className="cp-shortcut-label">{x.label}</span>
                        <span className="cp-shortcut-hint" id={`cp-hint-${x.id}`} aria-hidden="true">{x.hint}</span>
                      </button>
                    ))}
                    <div className="cp-shortcut-row" role="group" aria-label="Workflows">
                      {SHORTCUTS.filter((x) => x.layout === "workflow").map((x) => (
                        <button key={x.id} type="button" className="cp-shortcut" data-shortcut={x.id} aria-describedby={`cp-hint-${x.id}`} title={x.hint} disabled={busy} onClick={() => void send({ start: x.id }, x.label)}>
                          <span className="cp-shortcut-label">{x.label}</span>
                          <span className="sr-only" id={`cp-hint-${x.id}`} aria-hidden="true">{x.hint}</span>
                        </button>
                      ))}
                    </div>
                  </nav>
                  <div className="cp-trust">
                    <span className="cp-shield" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
                    </span>
                    <div>
                      <strong>Uses owner-approved rules</strong>
                      <p>I check requests against your organisation&apos;s policies before suggesting anything.</p>
                    </div>
                  </div>
                  <p className={`cp-mode ${aiLive ? "live" : "demo"}`}>{welcomeMode(aiLive)}</p>
                </div>
              )}
              {items.map((item, i) =>
                item.role === "user" ? (
                  <div key={item.id} className="cp-msg user"><div className="cp-bubble user">{item.text}</div></div>
                ) : (
                  <AssistantMessage
                    key={item.id}
                    item={item}
                    last={i === items.length - 1}
                    busy={busy}
                    sessionKey={sessionKey}
                    onPick={onPick}
                    onAction={onAction}
                    onCommand={onCommand}
                    onAnnounce={setAnnounce}
                    onRetry={() => lastSend.current && void send(lastSend.current.input, lastSend.current.label)}
                  />
                ),
              )}
              {busy && (
                <div className="cp-msg assistant">
                  <CompassAvatar size={28} state="thinking" className="cp-msg-avatar" />
                  <div className="cp-msg-body">
                    <div className="cp-bubble cp-typing" role="status"><span className="cp-dots" aria-hidden="true"><i /><i /><i /></span> Compass is checking…</div>
                  </div>
                </div>
              )}
            </div>
            {showNew && <button type="button" className="cp-new" onClick={scrollToEnd}>New message ↓</button>}

            <form className="cp-composer" onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>
              {attachNote && <p className="cp-attach-note" role="status">{attachNote}</p>}
              <div className="cp-input">
                <button type="button" className="cp-icon-btn" aria-label="Attach a text file" onClick={() => fileRef.current?.click()}><Svg name="clip" /></button>
                <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
                <label htmlFor="compass-input" className="sr-only">Message Compass</label>
                <textarea
                  id="compass-input"
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  placeholder="Ask Compass…"
                  maxLength={4000}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <button type="button" className="cp-icon-btn" aria-label="Start Voice Input" title="Start Voice Input" onClick={enterVoice} disabled={busy}><Svg name="mic" /></button>
                {busy ? (
                  <button type="button" className="cp-send stop" aria-label="Stop the reply" onClick={() => abortRef.current?.abort()}><Svg name="stop" /></button>
                ) : (
                  <button type="submit" className="cp-send" aria-label="Send message" disabled={!draft.trim()}><Svg name="send" /></button>
                )}
              </div>
              <p className="cp-footnote">AI suggests. Owner rules decide.</p>
            </form>
          </>
        ) : (
          <div className="cp-voice">
            <div className={`cp-voice-stage${voice.phase === "listening" ? " live" : ""}`}>
              <div className="cp-halo" aria-hidden="true" />
              <CompassAvatar state={avatarState} size={150} />
            </div>
            {/* Moves only while the microphone is actually capturing, and more when it hears sound. */}
            <div className={`cp-wave${voice.phase === "listening" ? " live" : ""}${voice.hearing ? " hearing" : ""}`} aria-hidden="true">
              {WAVE.map((i) => <span key={i} style={{ animationDelay: `${(i % 7) * -0.13 - i * 0.03}s` }} />)}
            </div>
            <p className="cp-voice-status" role="status">{voiceLabel}</p>
            {voice.error && <p className="cp-error" role="alert">{voice.error}</p>}
            <label htmlFor="compass-transcript" className="sr-only">Your words</label>
            <textarea
              id="compass-transcript"
              className="cp-transcript"
              rows={3}
              value={voice.transcript}
              placeholder={voice.phase === "listening" ? "Start speaking…" : "Your words will appear here."}
              onChange={(e) => voice.setTranscript(e.target.value)}
              readOnly={busy}
            />
            <p className="cp-small center">Review your words before sending.</p>
            <div className="cp-voice-actions">
              <div className="cp-mic-wrap">
                {voice.active ? (
                  <button type="button" className="cp-mic-btn on" onClick={voice.stop} aria-label={voice.phase === "requesting" ? "Stop Waiting for Microphone" : "Stop Voice Input"}>
                    <Svg name="stop" />
                  </button>
                ) : (
                  <button type="button" className="cp-mic-btn" onClick={voice.start} disabled={busy || !voice.supported} aria-label={voice.error ? "Try Voice Input Again" : "Start Voice Input"}>
                    <Svg name="mic" />
                  </button>
                )}
                <span className="cp-mic-caption" aria-hidden="true">{voice.active ? (voice.phase === "requesting" ? "Stop Waiting" : "Stop Voice Input") : voice.error ? "Try Again" : "Start Voice Input"}</span>
              </div>
              <div className="cp-voice-side">
                <button type="button" className="cp-btn" onClick={() => void sendVoice()} disabled={!voice.transcript.trim() || busy}>Send</button>
                <button type="button" className="cp-btn secondary" onClick={backToTyping} disabled={busy}><Svg name="keyboard" /> Type Instead</button>
                <button type="button" className="cp-btn secondary" onClick={cancelVoice} disabled={busy}>Cancel</button>
              </div>
            </div>
            <label className="cp-toggle">
              <input type="checkbox" checked={readAloud} disabled={!speech.available} onChange={(e) => { setReadAloud(e.target.checked); speech.cancel(); }} />
              <span className="cp-switch" aria-hidden="true" />
              Read replies aloud
            </label>
            <p className="cp-small center">Voice typing uses your browser&apos;s speech service. Nothing is sent to Tutor Compass until you press Send.</p>
          </div>
        )}
      </div>
    </div>
  );
}
