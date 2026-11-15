// One voice input session at a time, with one way to end it.
//
// Voice typing uses only the browser's speech recognition, which opens and closes the
// microphone itself. Tutor Compass doesn't open a second microphone stream of its own, so
// ending the recognition session is all it takes to give the microphone back.
//
// Kept free of React so the cleanup rules can be tested on their own.

export type RecognitionHandlers = {
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onsoundstart: (() => void) | null;
  onsoundend: (() => void) | null;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
export type RecognitionLike = RecognitionHandlers & {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

/**
 * requesting: waiting for the browser (or the person) to allow the microphone.
 * listening: the microphone is capturing.
 * finishing: capture has ended and the browser is turning the last words into text.
 */
export type VoicePhase = "idle" | "requesting" | "listening" | "finishing" | "error";
export type VoiceView = { phase: VoicePhase; hearing: boolean; error: string | null };

export const IDLE_VIEW: VoiceView = { phase: "idle", hearing: false, error: null };

export const VOICE_MESSAGES = {
  unsupported: "Voice input isn't available in this browser. Try Chrome, Edge or Safari, or type instead.",
  blocked: "Microphone access is blocked. Allow it in your browser's site settings, then try again, or type instead.",
  noMic: "No microphone was found. You can type instead.",
  network: "The browser's speech service couldn't be reached. Try again, or type instead.",
  noSpeech: "I didn't hear anything. Try again, or type instead.",
  nothingCaught: "I didn't catch anything. Try again, or type instead.",
  failed: "Voice input couldn't start. Try again, or type instead.",
  unclear: "I couldn't make that out. Try again, or type instead.",
} as const;

export function recognitionError(code: string): string | null {
  switch (code) {
    case "aborted": return null;
    case "no-speech": return VOICE_MESSAGES.noSpeech;
    case "not-allowed":
    case "service-not-allowed": return VOICE_MESSAGES.blocked;
    case "audio-capture": return VOICE_MESSAGES.noMic;
    case "network": return VOICE_MESSAGES.network;
    default: return VOICE_MESSAGES.unclear;
  }
}

const HANDLERS: (keyof RecognitionHandlers)[] = ["onstart", "onaudiostart", "onaudioend", "onsoundstart", "onsoundend", "onresult", "onerror", "onend"];

export class VoiceSession {
  private rec: RecognitionLike | null = null;
  private view: VoiceView = IDLE_VIEW;
  private heard = false;
  private base = "";
  private disposed = false;

  constructor(
    private readonly create: (() => RecognitionLike) | null,
    private readonly cb: { onChange: (v: VoiceView) => void; onTranscript: (t: string) => void },
  ) {}

  get state(): VoiceView {
    return this.view;
  }

  /** True while Tutor Compass owns a recognition session, including while permission is pending. */
  get active(): boolean {
    return this.rec !== null;
  }

  /**
   * Starts listening after a deliberate press. Returns false and does nothing if a session is
   * already running, so repeated clicks can't open a second one. `base` is text already in
   * the box; new words are added after it.
   */
  start(base: string, lang = "en-AU"): boolean {
    if (this.disposed || this.rec) return false;
    if (!this.create) {
      this.set({ phase: "error", hearing: false, error: VOICE_MESSAGES.unsupported });
      return false;
    }
    let rec: RecognitionLike;
    try {
      rec = this.create();
    } catch {
      this.set({ phase: "error", hearing: false, error: VOICE_MESSAGES.failed });
      return false;
    }
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    this.rec = rec;
    this.heard = false;
    this.base = base.trim();

    // A session that has already ended can still fire late events, for example when the
    // person allows the microphone after pressing Cancel. Those are shut down again and
    // otherwise ignored, so they can never turn listening back on.
    const stale = () => {
      if (this.rec === rec) return false;
      try { rec.abort(); } catch { /* already ended */ }
      return true;
    };
    rec.onstart = () => { stale(); };
    rec.onaudiostart = () => { if (!stale()) this.set({ phase: "listening" }); };
    rec.onsoundstart = () => { if (!stale()) this.set({ hearing: true }); };
    rec.onsoundend = () => { if (!stale()) this.set({ hearing: false }); };
    rec.onaudioend = () => { if (!stale()) this.set({ phase: "finishing", hearing: false }); };
    rec.onresult = (e) => {
      if (stale()) return;
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      if (said.trim()) this.heard = true;
      this.cb.onTranscript([this.base, said.trim()].filter(Boolean).join(" "));
    };
    rec.onerror = (e) => { if (!stale()) this.end(recognitionError(e.error)); };
    rec.onend = () => { if (!stale()) this.end(null); };

    this.set({ phase: "requesting", hearing: false, error: null });
    try {
      rec.start();
    } catch {
      this.end(VOICE_MESSAGES.failed);
      return false;
    }
    return true;
  }

  /** The person pressed Stop. Ends capture and keeps the words heard so far. */
  stop(): void {
    if (!this.rec) return;
    const nothing = this.view.phase === "listening" && !this.heard && !this.base;
    this.end(nothing ? VOICE_MESSAGES.nothingCaught : null);
  }

  /**
   * Ends capture quietly: Cancel, closing the panel, leaving the page or hiding the tab.
   * The words already in the box are left for the caller to keep or clear. Safe to call
   * any number of times.
   */
  release(): void {
    if (this.rec) this.end(null);
    else if (this.view.phase === "error") this.set(IDLE_VIEW);
  }

  /** For unmounting. Releases the microphone and ignores anything that happens afterwards. */
  dispose(): void {
    this.release();
    this.disposed = true;
  }

  /** The single cleanup path. Every way a session ends comes through here. */
  private end(error: string | null): void {
    const rec = this.rec;
    this.rec = null;
    if (rec) {
      // abort() rather than stop(): stop() lets the browser keep capturing while it works
      // out the last words, while abort() ends capture straight away. The words heard so
      // far are already in the box, so nothing the person saw is lost.
      try { rec.abort(); } catch { /* already ended */ }
      // Keep only the handlers that shut down late events; drop the rest.
      for (const h of HANDLERS) if (h !== "onstart" && h !== "onaudiostart") rec[h] = null;
    }
    this.set({ phase: error ? "error" : "idle", hearing: false, error });
  }

  private set(patch: Partial<VoiceView>): void {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch };
    this.cb.onChange(this.view);
  }
}
