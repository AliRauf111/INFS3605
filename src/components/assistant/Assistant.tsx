"use client";
import "./assistant.css";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EMPTY_STATE, type AssistantState, type Block, type Choice, type TaskField, type TurnResponse } from "@/lib/assistant/logic";
import { CompassAvatar, type AvatarState } from "./CompassAvatar";
import { AssistantMessage, type ActionState, type ChatItem } from "./Messages";
import { useSpeech, useVoice } from "./useVoice";

// Compass AI: the floating assistant on every signed-in page. This component owns the
// panel, the conversation and the voice controls. The server decides what to ask and
// runs the owner's rules; nothing here can change a decision.

type SendInput = { message?: string; answer?: { field: TaskField; value: string }; start?: "refund" | "lesson_change" | "policy" };
type Stored = { items: ChatItem[]; state: AssistantState; sessionKey: string; readAloud: boolean; draft: string };

const STORE = "compass.chat.v1";
const GREETED = "compass.greeted";

const uid = () => crypto.randomUUID();

function spokenText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.kind === "text" ? b.text : b.kind === "decision" ? `${b.title}. ${b.explanation}` : b.kind === "policy" ? b.answer : b.kind === "notice" ? b.text : ""))
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
  const [available, setAvailable] = useState(true);
  const [mood, setMood] = useState<AvatarState | null>(null);
  const [announce, setAnnounce] = useState("");
  const [attachNote, setAttachNote] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [paused, setPaused] = useState(false);
  const [modeNote, setModeNote] = useState(aiLive ? "Live AI reads your words. Owner rules decide." : "Demo mode: keyword rules, no live AI.");

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

  // Restore this tab's conversation, and greet once per session.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE);
      const saved = raw ? (JSON.parse(raw) as Stored) : null;
      setItems(saved?.items ?? []);
      setConv(saved?.state ?? EMPTY_STATE);
      setSessionKey(saved?.sessionKey || uid());
      setReadAloud(Boolean(saved?.readAloud));
      setDraft(saved?.draft ?? "");
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

  // The microphone is only ever on while voice mode is open and visible.
  const voiceStop = voice.stop;
  const voiceStatus = voice.status;
  useEffect(() => {
    if ((!open || mode !== "voice") && voiceStatus !== "idle") voiceStop();
  }, [open, mode, voiceStatus, voiceStop]);

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

  const scrollToEnd = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
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
  // Other parts of the page (the footer link, for example) open the panel with this event.
  const openRef = useRef(openPanel);
  openRef.current = openPanel;
  useEffect(() => {
    const onOpen = () => openRef.current();
    window.addEventListener("compass:open", onOpen);
    return () => window.removeEventListener("compass:open", onOpen);
  }, []);
  const minimise = () => {
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

  const onAction = (itemId: string, index: number, next: ActionState) => {
    setItems((xs) => xs.map((x) => (x.id === itemId ? { ...x, actions: { ...x.actions, [index]: next } } : x)));
    if (next.stage === "submitted" || (next.stage === "saved" && next.status === "ready")) flash("success");
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
  const enterVoice = () => {
    speech.cancel();
    voice.setTranscript("");
    voice.setError(null);
    setMode("voice");
    setAnnounce("Voice mode. Listening.");
    void voice.start();
  };
  const backToTyping = () => {
    voice.stop();
    const t = voice.transcript.trim();
    if (t) setDraft((d) => (d ? `${d} ${t}` : t));
    voice.setTranscript("");
    voice.setError(null);
    setMode("chat");
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const sendVoice = () => {
    const t = voice.transcript.trim();
    if (!t) return;
    voice.stop();
    voice.setTranscript("");
    voice.setError(null);
    setMode("chat");
    void send({ message: t }, t);
  };

  const avatarState: AvatarState = !available && !busy
    ? "error"
    : voice.status === "listening"
      ? "listening"
      : busy
        ? "thinking"
        : speech.speaking
          ? "speaking"
          : mood ?? "idle";

  const showWelcome = items.length === 0;

  return (
    <div className="compass-root" data-paused={paused ? "true" : undefined}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>

      {greeting && !open && (
        <div className="cl-greeting" role="status">
          <span>Hi {firstName}. Need a hand?</span>
          <button type="button" className="cl-greeting-close" aria-label="Dismiss greeting" onClick={() => setGreeting(false)}><Svg name="close" /></button>
        </div>
      )}

      <div className={`cl-launcher${open ? " is-open" : ""}`}>
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
                  <div className="cp-chips cp-starters">
                    <button type="button" className="cp-chip" onClick={() => void send({ start: "refund" }, "Check a refund")}>Check a refund</button>
                    <button type="button" className="cp-chip" onClick={() => void send({ start: "lesson_change" }, "Change a lesson")}>Change a lesson</button>
                    <button type="button" className="cp-chip" onClick={() => void send({ start: "policy" }, "Find a policy")}>Find a policy</button>
                  </div>
                  <div className="cp-trust">
                    <span className="cp-shield" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
                    </span>
                    <div>
                      <strong>Uses owner-approved rules</strong>
                      <p>I check requests against your organisation&apos;s policies before suggesting anything.</p>
                    </div>
                  </div>
                  <p className={`cp-mode ${aiLive ? "live" : "demo"}`}>{modeNote}</p>
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
                    onPick={onPick}
                    onAction={onAction}
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
                <button type="button" className="cp-icon-btn" aria-label="Speak instead of typing" onClick={enterVoice} disabled={busy}><Svg name="mic" /></button>
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
            <div className={`cp-voice-stage${voice.status === "listening" ? " live" : ""}`}>
              <div className="cp-halo" aria-hidden="true" />
              <CompassAvatar state={avatarState} size={150} />
            </div>
            <div className="cp-wave" aria-hidden="true">
              {voice.levels.map((l, i) => <span key={i} style={{ transform: `scaleY(${0.08 + l * 0.92})` }} />)}
            </div>
            <p className="cp-voice-status" role="status">
              {voice.status === "listening" ? "Listening…" : voice.status === "starting" ? "Starting the microphone…" : voice.transcript ? "Stopped listening." : "Microphone off."}
            </p>
            {voice.error && <p className="cp-error" role="alert">{voice.error}</p>}
            <label htmlFor="compass-transcript" className="sr-only">Your words</label>
            <textarea
              id="compass-transcript"
              className="cp-transcript"
              rows={3}
              value={voice.transcript}
              placeholder={voice.status === "listening" ? "Start speaking…" : "Your words will appear here."}
              onChange={(e) => voice.setTranscript(e.target.value)}
            />
            <p className="cp-small center">Review your words before sending.</p>
            <div className="cp-voice-actions">
              {voice.status === "listening" || voice.status === "starting" ? (
                <button type="button" className="cp-mic-btn on" onClick={voice.stop} aria-label="Stop listening"><Svg name="stop" /><span>Stop</span></button>
              ) : (
                <button type="button" className="cp-mic-btn" onClick={() => void voice.start()} aria-label={voice.transcript ? "Listen again" : "Start listening"}><Svg name="mic" /><span>{voice.transcript ? "Again" : "Speak"}</span></button>
              )}
              <div className="cp-voice-side">
                <button type="button" className="cp-btn" onClick={sendVoice} disabled={!voice.transcript.trim() || busy}>Send</button>
                <button type="button" className="cp-btn secondary" onClick={backToTyping}><Svg name="keyboard" /> Back to typing</button>
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
