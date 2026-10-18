"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Voice typing with the browser's own speech recognition. The waveform comes from the
// real microphone signal, so it only moves when the microphone is actually capturing.
// Nothing is sent to Tutor Compass until the person reviews the words and presses Send.

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceStatus = "idle" | "starting" | "listening";
const BARS = 28;

export function useVoice() {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscriptState] = useState("");
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [supported, setSupported] = useState(true);
  const transcriptRef = useRef("");
  const recRef = useRef<Recognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const heardRef = useRef(false);

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const setTranscript = useCallback((t: string) => {
    transcriptRef.current = t;
    setTranscriptState(t);
  }, []);

  const releaseMic = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => undefined);
    ctxRef.current = null;
    setLevels(Array(BARS).fill(0));
  }, []);

  const stop = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onend = null;
      try { rec.stop(); } catch { /* already stopped */ }
    }
    releaseMic();
    setStatus("idle");
    if (rec && !heardRef.current && !transcriptRef.current.trim()) setError("I didn't catch anything. Tap the microphone to try again, or type instead.");
  }, [releaseMic]);

  const start = useCallback(async () => {
    setError(null);
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError("Voice typing isn't available in this browser. Try Chrome, Edge or Safari, or keep typing.");
      return;
    }
    if (recRef.current) return;
    window.speechSynthesis?.cancel();
    setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access is blocked. Allow it in your browser's site settings, or keep typing."
        : name === "NotFoundError"
          ? "No microphone was found. You can keep typing instead."
          : "The microphone couldn't start. You can keep typing instead.");
      setStatus("idle");
      return;
    }
    streamRef.current = stream;

    // Real input level for the waveform.
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      ctx.createMediaStreamSource(stream).connect(analyser);
      ctxRef.current = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const next: number[] = [];
        for (let i = 0; i < BARS; i++) next.push(data[2 + i] / 255);
        setLevels(next);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // The waveform is optional. Without it the bars stay flat.
    }

    const base = transcriptRef.current.trim();
    heardRef.current = false;
    const rec = new Ctor();
    rec.lang = "en-AU";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      if (said.trim()) heardRef.current = true;
      setTranscript([base, said.trim()].filter(Boolean).join(" "));
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      setError(
        e.error === "no-speech"
          ? "I didn't hear anything. Tap the microphone to try again."
          : e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "Microphone access is blocked. Allow it in your browser's site settings, or keep typing."
            : e.error === "network"
              ? "The browser's speech service couldn't be reached. You can keep typing instead."
              : "I couldn't make that out. Try again, or type instead.",
      );
    };
    rec.onend = () => {
      recRef.current = null;
      releaseMic();
      setStatus("idle");
    };
    recRef.current = rec;
    try {
      rec.start();
      setStatus("listening");
    } catch {
      recRef.current = null;
      releaseMic();
      setStatus("idle");
      setError("Voice typing couldn't start. Try again, or type instead.");
    }
  }, [releaseMic, setTranscript]);

  // Never leave the microphone on after the component goes away.
  useEffect(() => () => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onend = null;
      try { rec.abort(); } catch { /* ignore */ }
    }
    releaseMic();
  }, [releaseMic]);

  return { status, error, setError, transcript, setTranscript, levels, supported, start, stop };
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
