"use client";
import "./assistant.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { EMPTY_STATE, type AssistantState, type Block, type Choice, type Command, type TaskField, type TurnResponse } from "@/lib/assistant/logic";
import { SHORTCUTS, type ShortcutId } from "@/lib/assistant/shortcuts";
import { CompassAvatar, type AvatarState } from "./CompassAvatar";
import { Icon as StudioIcon, type IconName } from "@/components/Icons";
import { BotScene } from "@/components/BotScene";
import { AssistantMessage, type ActionState, type ChatItem } from "./Messages";
import { useSpeech, useVoice } from "./useVoice";
import { motionReduced } from "@/lib/a11y/motion";
import { DEMO_EPOCH_COOKIE, freshChat, readCookie } from "@/lib/demo/mode";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Translate } from "@/lib/i18n/core";
import { VOICE_MESSAGES } from "./voice-session";
import { isNearBottom, lockPageScroll, makeSiblingsInert, scrollTargetForNew, stopMedia, workspaceGeometry, type WorkspaceGeometry } from "@/lib/assistant/workspace";

// Compass AI: the floating assistant on every signed-in page. This component owns the
// workspace, the conversation and the voice controls. The server decides what to ask and
// runs the owner's rules; nothing here can change a decision.
//
// Opening the launcher expands Compass into a frosted workspace over almost the whole
// screen, with a narrow column on the right kept for the launcher. The layer is portalled
// to <body> so no page container can clip it. While it is open the page underneath is
// blurred, inert and can't scroll; the layer itself is the modal dialog, and the launcher
// stays inside it as a second close control.

type SendInput = {
  message?: string;
  answer?: { field: TaskField; value: string };
  start?: ShortcutId;
  command?: Command;
};
/** demoEpoch: the demo reset this chat started after, so a later reset starts a fresh chat. */
type Stored = { items: ChatItem[]; state: AssistantState; sessionKey: string; readAloud: boolean; draft: string; demoEpoch?: string | null };

const STORE = "compass.chat.v2";
const GREETED = "compass.greeted";

const uid = () => crypto.randomUUID();

/** What the welcome screen says about AI. It only changes with the server's AI setting. */
const SHORTCUT_ICON: Record<ShortcutId, IconName> = { attention: "requests", lesson_change: "calendar", payment_extension: "wallet", tutor_absence: "people" };

function welcomeMode(aiLive: boolean, t: Translate): string {
  return aiLive ? t("compass.welcomeLive") : t("compass.welcomeDemo");
}

/** The voice session reports its fixed English messages; show them in the chosen language. */
function voiceError(message: string, t: Translate): string {
  const key = (Object.keys(VOICE_MESSAGES) as (keyof typeof VOICE_MESSAGES)[]).find((k) => VOICE_MESSAGES[k] === message);
  return key ? t(`compass.voice.error.${key}`) : message;
}

// Read aloud with an English voice alongside the English replies, so this stays English.
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
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
  keyboard: <path d="M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10" />,
  speaker: <path d="M4 10v4h4l5 4V6L8 10zM16 9a4 4 0 0 1 0 6" />,
};
function Svg({ name, label }: { name: keyof typeof Icon; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill={name === "stop" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={name === "more" ? 3.2 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} data-flip={name === "send" ? "" : undefined}>
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
  const { t, lang } = useI18n();
  // The server's own note (English) once Compass has replied; until then the welcome text.
  const [serverNote, setServerNote] = useState<string | null>(null);
  const modeNote = serverNote ?? welcomeMode(aiLive, t);
  const [geom, setGeom] = useState<WorkspaceGeometry | null>(null);
  const [demoEpoch, setDemoEpoch] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastSend = useRef<{ input: SendInput; label: string } | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  // The button that opened Compass (a page button or the launcher), so focus goes back to it.
  const openerRef = useRef<HTMLElement | null>(null);
  // Set when a confirmed change was saved, so the page underneath refreshes its counts on close.
  const changedRef = useRef(false);

  const voice = useVoice();
  const speech = useSpeech();

  // Restore this tab's conversation, and greet once per session. Reloading the page
  // starts a fresh, empty chat; only the read-aloud setting is kept. So does any page load
  // that put the demo data back to its original state (in demo mode), so Compass never
  // carries on a workflow about records that have been reset. Moving between pages and
  // opening or closing Compass keep the chat.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE);
      const saved = raw ? (JSON.parse(raw) as Stored) : null;
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const epoch = readCookie(document.cookie, DEMO_EPOCH_COOKIE);
      setDemoEpoch(epoch);
      const fresh = freshChat({ reloaded: nav?.type === "reload", savedEpoch: saved?.demoEpoch, currentEpoch: epoch });
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
      sessionStorage.setItem(STORE, JSON.stringify({ items: items.slice(-60), state: conv, sessionKey, readAloud, draft, demoEpoch } satisfies Stored));
    } catch { /* storage full or blocked */ }
  }, [hydrated, items, conv, sessionKey, readAloud, draft, demoEpoch]);

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

  // Size the workspace against what is actually visible, so it stays above an on-screen
  // keyboard and follows rotation, zoom and resizing. One set of listeners per mount.
  const measure = useCallback(() => {
    const vv = window.visualViewport;
    const rail = document.querySelector<HTMLElement>(".rail");
    // Right to left, the rail sits on the right, so measure it from that edge.
    const rtl = document.documentElement.dir === "rtl";
    const width = document.documentElement.clientWidth || window.innerWidth;
    const railBox = rail && getComputedStyle(rail).position === "fixed" ? rail.getBoundingClientRect() : null;
    const next = workspaceGeometry({
      width,
      height: vv?.height ?? window.innerHeight,
      offsetTop: vv?.offsetTop ?? 0,
      rail: railBox ? (rtl ? width - railBox.left : railBox.right) : 0,
    });
    setGeom((g) => (g && g.mode === next.mode && g.top === next.top && g.left === next.left && g.width === next.width && g.height === next.height && g.rail === next.rail ? g : next));
  }, []);
  useLayoutEffect(() => {
    if (!hydrated) return;
    measure();
    const vv = window.visualViewport;
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [hydrated, measure]);
  // Switching to or from Arabic moves the rail to the other side, so measure again.
  useEffect(() => {
    if (!hydrated) return;
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [hydrated, measure, lang]);

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

  // A new message only moves the conversation if the person was already at the bottom.
  // Anyone reading further up stays where they are and gets a "New message" button. A long
  // reply is shown from its top rather than its last line.
  useEffect(() => {
    // The welcome screen always starts at its top.
    if (!open || (items.length === 0 && !busy)) return;
    if (!nearBottom.current) {
      setShowNew(true);
      return;
    }
    const frame = requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      const msgs = el.querySelectorAll<HTMLElement>(".cp-msg.assistant:not(.cp-pending)");
      const last = itemsRef.current[itemsRef.current.length - 1];
      const lastMsg = last?.role === "assistant" && !busy ? msgs[msgs.length - 1] : undefined;
      let top: number | null = null;
      if (lastMsg && lastMsg.offsetHeight > el.clientHeight - 24) {
        top = lastMsg.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      }
      el.scrollTo({ top: scrollTargetForNew(el, top), behavior: motionReduced() ? "auto" : "smooth" });
      setShowNew(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [items.length, busy, open]);

  const openPanel = () => {
    measure();
    setOpen(true);
    setGreeting(false);
    flash("wave", 1000);
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

  // Other parts of the page (the Compass AI card, the rail, the footer link) open the panel
  // with this event. Focus goes back to whatever opened it.
  const openRef = useRef(openPanel);
  openRef.current = openPanel;
  // A button can also start one of the shortcuts straight away, such as "Change a lesson"
  // on the Schedule page.
  const startRef = useRef<((input: SendInput, label: string) => unknown) | null>(null);
  const labelRef = useRef((id: ShortcutId) => t(`compass.shortcut.${id}.label`));
  labelRef.current = (id: ShortcutId) => t(`compass.shortcut.${id}.label`);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ opener?: HTMLElement; shortcut?: string }>).detail;
      openerRef.current = detail?.opener instanceof HTMLElement ? detail.opener : null;
      openRef.current();
      const shortcut = SHORTCUTS.find((s) => s.id === detail?.shortcut);
      if (shortcut) void startRef.current?.({ start: shortcut.id }, labelRef.current(shortcut.id));
    };
    window.addEventListener("compass:open", onOpen);
    return () => window.removeEventListener("compass:open", onOpen);
  }, []);
  // Closing keeps the conversation, any workflow in progress and the draft. It only stops
  // the microphone and anything being read aloud. Words heard in voice mode go into the
  // message box so they aren't lost. Only New conversation clears anything.
  const closePanel = () => {
    if (mode === "voice") {
      const words = voice.transcript.trim();
      if (words) setDraft((d) => (d ? `${d} ${words}` : words));
      voice.setTranscript("");
    }
    stopMedia({ releaseMic: voice.release, stopSpeaking: speech.cancel });
    setOpen(false);
    setMenuOpen(false);
    setMode("chat");
    const back = openerRef.current?.isConnected && openerRef.current.getClientRects().length ? openerRef.current : launcherRef.current;
    openerRef.current = null;
    requestAnimationFrame(() => back?.focus({ preventScroll: true }));
    // A change was confirmed while Compass was open: refresh the page's counts and lists.
    // This re-reads the page's data only. It is not a full page load, so it never resets demo data.
    if (changedRef.current) {
      changedRef.current = false;
      router.refresh();
    }
  };
  const closeRef = useRef(closePanel);
  closeRef.current = closePanel;
  const menuOpenRef = useRef(menuOpen);
  menuOpenRef.current = menuOpen;

  // Following a link from the conversation (Open Request, a policy) closes the workspace
  // so the new page is visible. The conversation is kept for when it is opened again.
  const openStateRef = useRef(open);
  openStateRef.current = open;
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (openStateRef.current) closeRef.current();
  }, [pathname]);

  // While open: the page keeps its scroll position but can't scroll, everything outside
  // the Compass layer is inert, and focus moves in and stays in.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const unlock = lockPageScroll(document, window.innerWidth, CSS.supports?.("scrollbar-gutter: stable") ?? false);
    const restore = makeSiblingsInert(document.body.children as unknown as Iterable<HTMLElement>, root);
    // Anything the page adds to <body> while Compass is open (a toast, a menu) is inert too.
    const mo = new MutationObserver((records) => {
      for (const r of records) restore.add([...r.addedNodes].filter((n): n is HTMLElement => n instanceof HTMLElement));
    });
    mo.observe(document.body, { childList: true });

    const focusables = () =>
      [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]") && getComputedStyle(el).visibility !== "hidden");
    // Escape closes from anywhere while open, even when focus has dropped to <body> (for
    // example after the button that had it was removed). An open menu closes first.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        if (menuOpenRef.current) setMenuOpen(false);
        else closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !root.contains(e.target)) focusables()[0]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);

    // Focus goes to the message box. On touch screens it goes to the title instead, so the
    // keyboard doesn't jump up over the welcome screen before the person asks for it.
    const frame = requestAnimationFrame(() => {
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const target = !touch && inputRef.current?.offsetParent ? inputRef.current : titleRef.current;
      target?.focus({ preventScroll: true });
      if (nearBottom.current && itemsRef.current.length) {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      mo.disconnect();
      restore();
      unlock();
    };
  }, [open]);

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
      if (!res.ok) throw new Error((json as { error?: string }).error ?? t("compass.problem", { status: res.status }));
      const turn = json as TurnResponse;
      setItems((xs) => [...xs, { id: uid(), role: "assistant", blocks: turn.blocks, steps: turn.steps, modeNote: turn.modeNote }]);
      setConv(turn.state);
      setServerNote(turn.modeNote);
      setAvailable(true);
      flash(turn.mood === "success" ? "success" : turn.mood === "clarify" ? "clarify" : turn.mood === "error" ? "error" : "replying");
      const spoken = spokenText(turn.blocks);
      setAnnounce(t("compass.said", { text: spoken }));
      if (readAloud) speech.speak(spoken);
    } catch (e) {
      const stopped = e instanceof DOMException && e.name === "AbortError";
      setItems((xs) => [
        ...xs.filter((x) => x.id !== userItem.id),
        {
          id: uid(), role: "assistant", error: !stopped,
          text: stopped
            ? t("compass.stopped")
            : t("compass.errorKept", { error: e instanceof Error && e.message !== "Failed to fetch" ? e.message : t("compass.couldntReply") }),
        },
      ]);
      if (input.message) setDraft(input.message);
      if (!stopped) {
        setAvailable(false);
        flash("error", 2500);
      }
      setAnnounce(stopped ? t("compass.stoppedShort") : t("compass.couldntReply"));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [busy, sessionKey, conv, flash, readAloud, speech, t]);
  startRef.current = send;

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
    if (next.card?.p?.stage === "done") {
      changedRef.current = true;
      flash("success");
    }
  };

  const newConversation = () => {
    setMenuOpen(false);
    if (items.length && !window.confirm(t("compass.confirmNew"))) return;
    abortRef.current?.abort();
    speech.cancel();
    setItems([]);
    setConv(EMPTY_STATE);
    setSessionKey(uid());
    setDraft("");
    setServerNote(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!(file.type === "text/plain" || /\.txt$/i.test(file.name))) {
      setAttachNote(t("compass.onlyTxt"));
      return;
    }
    if (file.size > 20_000) {
      setAttachNote(t("compass.tooLong"));
      return;
    }
    const text = (await file.text()).trim().slice(0, 3500);
    setDraft((d) => (d ? `${d}\n\n${text}` : text));
    setAttachNote(t("compass.addedFile", { name: file.name }));
    inputRef.current?.focus();
  };

  // Voice mode
  // Starts only from a press of a microphone button, never on its own.
  const enterVoice = () => {
    speech.cancel();
    voice.release();
    voice.setTranscript("");
    setMode("voice");
    setAnnounce(t("compass.voiceModeOn"));
    voice.start();
    // The button pressed is replaced by voice mode, so put focus on its main control.
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(".cp-mic-btn")?.focus({ preventScroll: true }));
  };
  const leaveVoice = (keepWords: boolean) => {
    voice.release();
    const words = voice.transcript.trim();
    if (keepWords && words) setDraft((d) => (d ? `${d} ${words}` : words));
    voice.setTranscript("");
    setMode("chat");
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  // Type Instead keeps the words heard so far. Cancel throws away this voice input only;
  // anything already typed in the message box stays.
  const backToTyping = () => leaveVoice(true);
  const cancelVoice = () => leaveVoice(false);
  const sendVoice = async () => {
    const words = voice.transcript.trim();
    if (!words || busy) return;
    // Give the microphone back before waiting for Compass to reply.
    voice.release();
    voice.setTranscript("");
    await send({ message: words }, words);
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
    ? t("compass.voice.processing")
    : voice.phase === "requesting"
      ? t("compass.voice.waitingPermission")
      : voice.phase === "listening"
        ? t("compass.voice.listening")
        : voice.phase === "finishing"
          ? t("compass.voice.processing")
          : voice.transcript.trim() && !voice.error
            ? t("compass.voice.offCheck")
            : t("compass.voice.off");


  // geom.left is the distance from the rail's side, which is the right edge in Arabic.
  const panelStyle: CSSProperties | undefined = geom
    ? { top: geom.top, insetInlineStart: geom.left, width: geom.width, height: geom.height }
    : undefined;
  const indicator = aiLive ? t("compass.liveAi") : t("compass.demoMode");

  // Rendered into <body> once mounted, so no page container or stacking context can clip it.
  if (!hydrated) return null;
  return createPortal(
    <div
      ref={rootRef}
      className={`compass-root${open ? " is-open" : ""}`}
      data-paused={paused ? "true" : undefined}
      data-layout={geom?.mode ?? "column"}
      style={{ "--cp-rail": `${geom?.rail ?? 0}px` } as CSSProperties}
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
      aria-labelledby={open ? "compass-title" : undefined}
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>

      {/* Blurs and dims the page while Compass is open, and takes any click meant for it. */}
      <div className="cp-backdrop ai-layer" aria-hidden="true" />

      {greeting && !open && !dodge && (
        <div className="cl-greeting" role="status">
          <span>{t("compass.greeting", { name: firstName })}</span>
          <button type="button" className="cl-greeting-close" aria-label={t("compass.dismissGreeting")} onClick={() => setGreeting(false)}><Svg name="close" /></button>
        </div>
      )}

      <div
        id="compass-panel"
        className={`cp-panel ai-shell${open ? " open" : ""} mode-${mode}`}
        style={panelStyle}
        aria-hidden={!open}
        inert={!open}
      >
        <header className="cp-header ai-header">
          <div className="ai-brand">
            <span className="small-orb" aria-hidden="true">✦</span>
            <div>
              <h2 id="compass-title" ref={titleRef} tabIndex={-1}>{t("compass.title")}</h2>
              <span>{mode === "voice" ? t("compass.voiceMode") : t("compass.tagline")}</span>
            </div>
            <span className="badge lilac" title={modeNote}>{indicator}</span>
          </div>
          <div className="ai-actions">
            {speech.speaking && (
              <button type="button" className="cp-icon-btn" onClick={speech.cancel} aria-label={t("compass.stopReading")} title={t("compass.stopReading")}><Svg name="stop" /></button>
            )}
            <button type="button" className="text-btn" onClick={newConversation}>
              <StudioIcon name="refresh" /> {t("compass.startOver")}
            </button>
            <div className="cp-menu-wrap">
              <button type="button" className="cp-icon-btn" aria-label={t("compass.settings")} title={t("compass.settings")} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Svg name="more" /></button>
              {menuOpen && (
                <div className="cp-menu" role="menu">
                  <button type="button" role="menuitemcheckbox" aria-checked={readAloud} disabled={!speech.available} onClick={() => { setReadAloud((v) => !v); speech.cancel(); }}>
                    <span className={`cp-check${readAloud ? " on" : ""}`} aria-hidden="true">{readAloud ? "✓" : ""}</span> {t("compass.readAloud")}
                  </button>
                  <p className="cp-menu-note" lang={serverNote ? "en" : undefined}>{modeNote}</p>
                  {lang !== "en" && <p className="cp-menu-note">{t("compass.repliesEnglish")}</p>}
                </div>
              )}
            </div>
            <button type="button" className="icon-btn" onClick={closePanel} aria-label={t("compass.close")} title={t("compass.close")}><StudioIcon name="close" /></button>
          </div>
        </header>

        {mode === "chat" ? (
          <>
            <div className="cp-body">
              <div
                className="cp-list"
                ref={listRef}
                onScroll={(e) => {
                  nearBottom.current = isNearBottom(e.currentTarget);
                  if (nearBottom.current) setShowNew(false);
                }}
              >
                <div className="cp-col">
                  {showWelcome && (
                    <section className="cp-welcome ai-welcome">
                      <BotScene />
                      <p className="eyebrow">{t("compass.eyebrow")}</p>
                      <h3>{t("compass.welcomeLine1")}<br />{t("compass.welcomeLine2")}</h3>
                      <p>{t("compass.welcomeIntro1", { name: firstName })}<br />{t("compass.welcomeIntro2")}</p>
                      {lang !== "en" && <p className="hint">{t("compass.repliesEnglish")}</p>}
                      <nav className="shortcuts" aria-label={t("compass.shortcutsLabel")}>
                        {SHORTCUTS.map((x) => (
                          <button key={x.id} type="button" className="shortcut" data-shortcut={x.id} disabled={busy} onClick={() => void send({ start: x.id }, t(`compass.shortcut.${x.id}.label`))}>
                            <span className="sc-icon" aria-hidden="true"><StudioIcon name={SHORTCUT_ICON[x.id]} /></span>
                            <div><strong>{t(`compass.shortcut.${x.id}.label`)}</strong><p>{t(`compass.shortcut.${x.id}.hint`)}</p></div>
                            {x.layout === "wide" && <StudioIcon name="arrow" />}
                          </button>
                        ))}
                      </nav>
                      <div className="welcome-foot"><StudioIcon name="info" />{aiLive ? t("compass.welcomeFootLive") : t("compass.welcomeFootDemo")} · {t("compass.welcomeFootRest")}</div>
                    </section>
                  )}
                  {items.map((item, i) =>
                    item.role === "user" ? (
                      <div key={item.id} className="cp-msg user"><div className="cp-bubble user" dir="auto">{item.text}</div></div>
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
                    <div className="cp-msg assistant cp-pending">
                      <CompassAvatar size={28} state="thinking" className="cp-msg-avatar" />
                      <div className="cp-msg-body">
                        <div className="cp-bubble cp-typing" role="status"><span className="cp-dots" aria-hidden="true"><i /><i /><i /></span> {t("compass.checking")}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {showNew && <button type="button" className="cp-new" onClick={scrollToEnd}>{t("compass.newMessage")}</button>}
            </div>

            <form className="cp-composer" onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>
              <div className="cp-col">
                {attachNote && <p className="cp-attach-note" role="status">{attachNote}</p>}
                <div className="cp-input">
                  <button type="button" className="cp-icon-btn" aria-label={t("compass.attach")} title={t("compass.attach")} onClick={() => fileRef.current?.click()}><Svg name="clip" /></button>
                  <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
                  <label htmlFor="compass-input" className="sr-only">{t("compass.messageLabel")}</label>
                  <textarea
                    id="compass-input"
                    ref={inputRef}
                    rows={1}
                    value={draft}
                    placeholder={t("compass.placeholder")}
                    dir="auto"
                    maxLength={4000}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                  />
                  <button type="button" className="cp-icon-btn" aria-label={t("compass.startVoice")} title={t("compass.startVoice")} onClick={enterVoice} disabled={busy}><Svg name="mic" /></button>
                  {busy ? (
                    <button type="button" className="cp-send stop" aria-label={t("compass.stopReply")} title={t("compass.stopReply")} onClick={() => abortRef.current?.abort()}><Svg name="stop" /></button>
                  ) : (
                    <button type="submit" className="cp-send" aria-label={t("compass.send")} title={t("compass.send")} disabled={!draft.trim()}><Svg name="send" /></button>
                  )}
                </div>
                <p className="cp-footnote">{t("compass.footnote")}</p>
              </div>
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
            {voice.error && <p className="cp-error" role="alert">{voiceError(voice.error, t)}</p>}
            <label htmlFor="compass-transcript" className="sr-only">{t("compass.voice.yourWords")}</label>
            <textarea
              id="compass-transcript"
              className="cp-transcript"
              rows={3}
              value={voice.transcript}
              placeholder={voice.phase === "listening" ? t("compass.voice.startSpeaking") : t("compass.voice.wordsAppear")}
              dir="auto"
              onChange={(e) => voice.setTranscript(e.target.value)}
              readOnly={busy}
            />
            <p className="cp-small center">{t("compass.voice.review")}{lang !== "en" ? ` ${t("compass.voice.englishNote")}` : ""}</p>
            <div className="cp-voice-actions">
              <div className="cp-mic-wrap">
                {voice.active ? (
                  <button type="button" className="cp-mic-btn on" onClick={voice.stop} aria-label={voice.phase === "requesting" ? t("compass.voice.stopWaiting") : t("compass.voice.stopVoice")}>
                    <Svg name="stop" />
                  </button>
                ) : (
                  <button type="button" className="cp-mic-btn" onClick={voice.start} disabled={busy || !voice.supported} aria-label={voice.error ? t("compass.voice.tryAgainVoice") : t("compass.startVoice")}>
                    <Svg name="mic" />
                  </button>
                )}
                <span className="cp-mic-caption" aria-hidden="true">{voice.active ? (voice.phase === "requesting" ? t("compass.voice.stopWaitingShort") : t("compass.voice.stopVoice")) : voice.error ? t("compass.voice.tryAgain") : t("compass.startVoice")}</span>
              </div>
              <div className="cp-voice-side">
                <button type="button" className="cp-btn" onClick={() => void sendVoice()} disabled={!voice.transcript.trim() || busy}>{t("compass.voice.send")}</button>
                <button type="button" className="cp-btn secondary" onClick={backToTyping} disabled={busy}><Svg name="keyboard" /> {t("compass.voice.typeInstead")}</button>
                <button type="button" className="cp-btn secondary" onClick={cancelVoice} disabled={busy}>{t("compass.voice.cancel")}</button>
              </div>
            </div>
            <label className="cp-toggle">
              <input type="checkbox" checked={readAloud} disabled={!speech.available} onChange={(e) => { setReadAloud(e.target.checked); speech.cancel(); }} />
              <span className="cp-switch" aria-hidden="true" />
              {t("compass.readAloud")}
            </label>
            <p className="cp-small center">{t("compass.voice.privacy")}</p>
          </div>
        )}
      </div>

      {/* After the workspace in the DOM, so Tab goes from the composer to the launcher and back round. */}
      <div ref={launcherBoxRef} className={`cl-launcher${open ? " is-open" : ""}${dodge && !open ? ` is-${dodge}` : ""}`}>
        <button type="button" className="cl-pill" onClick={open ? closePanel : () => { openerRef.current = null; openPanel(); }} tabIndex={-1} aria-hidden="true">
          <StudioIcon name="sparkle" />
          {t("compass.launcher")}
        </button>
        <button
          ref={launcherRef}
          type="button"
          className="cl-avatar-btn"
          onClick={open ? closePanel : () => { openerRef.current = null; openPanel(); }}
          aria-expanded={open}
          aria-controls="compass-panel"
          aria-label={open ? t("compass.close") : available ? t("compass.openLauncher") : t("compass.openLauncherTrouble")}
        >
          {/* The Studio robot, as on the welcome screen. */}
          <span className="bot launcher-bot" aria-hidden="true"><span className="antenna" /><span className="bot-face"><i className="bot-eye" /><i className="bot-eye" /></span></span>
          <span className={`cl-dot ${available ? "on" : "off"}`} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
