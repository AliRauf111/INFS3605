"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { IDLE_VIEW, VoiceSession, type RecognitionLike, type VoiceView } from "./voice-session";

// Voice typing with the browser's own speech recognition. VoiceSession owns the
// microphone; this hook ties it to the page so capture always ends when the person
// leaves the page, switches tab or the component goes away. Nothing is sent to Tutor
// Compass until the person reviews the words and presses Send.

function recognitionFactory(): (() => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? () => new Ctor() : null;
}

export function useVoice() {
  const [view, setView] = useState<VoiceView>(IDLE_VIEW);
  const [transcript, setTranscriptState] = useState("");
  const [supported, setSupported] = useState(true);
  const transcriptRef = useRef("");
  const sessionRef = useRef<VoiceSession | null>(null);
  const pathname = usePathname();

  const setTranscript = useCallback((t: string) => {
    transcriptRef.current = t;
    setTranscriptState(t);
  }, []);

  // One session per mount. Unmounting disposes it, which releases the microphone.
  useEffect(() => {
    const factory = recognitionFactory();
    setSupported(factory !== null);
    const session = new VoiceSession(factory, { onChange: setView, onTranscript: setTranscript });
    sessionRef.current = session;
    return () => {
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [setTranscript]);

  // Never keep listening in the background: release on tab switch, minimising the
  // window, leaving the page or going into the back/forward cache.
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") sessionRef.current?.release(); };
    const onLeave = () => sessionRef.current?.release();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, []);

  // The assistant stays mounted across pages, so moving to another page releases too.
  useEffect(() => {
    sessionRef.current?.release();
  }, [pathname]);

  const start = useCallback(() => {
    window.speechSynthesis?.cancel();
    sessionRef.current?.start(transcriptRef.current);
  }, []);
  const stop = useCallback(() => sessionRef.current?.stop(), []);
  const release = useCallback(() => sessionRef.current?.release(), []);
  const clearError = useCallback(() => {
    if (sessionRef.current?.state.phase === "error") sessionRef.current.release();
  }, []);

  const active = view.phase === "requesting" || view.phase === "listening" || view.phase === "finishing";
  return { phase: view.phase, hearing: view.hearing, error: view.error, active, transcript, setTranscript, supported, start, stop, release, clearError };
}

/** Spoken replies with the browser's speech synthesis. Off unless the person turns it on. */
export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const available = typeof window !== "undefined" && "speechSynthesis" in window;
  const speak = useCallback((text: string) => {
    if (!available || !text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.rate = 1.02;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, [available]);
  const cancel = useCallback(() => {
    if (available) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [available]);
  useEffect(() => () => { if (available) window.speechSynthesis.cancel(); }, [available]);
  return { speaking, speak, cancel, available };
}
