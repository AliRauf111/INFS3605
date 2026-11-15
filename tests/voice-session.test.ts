import { describe, expect, it } from "vitest";
import { VOICE_MESSAGES, VoiceSession, type RecognitionLike, type VoiceView } from "@/components/assistant/voice-session";

// A stand-in for the browser's speech recognition. `capturing` mirrors whether the
// browser would be holding the microphone: on from audiostart until abort, stop or end.
class FakeRecognition implements RecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: RecognitionLike["onstart"] = null;
  onaudiostart: RecognitionLike["onaudiostart"] = null;
  onaudioend: RecognitionLike["onaudioend"] = null;
  onsoundstart: RecognitionLike["onsoundstart"] = null;
  onsoundend: RecognitionLike["onsoundend"] = null;
  onresult: RecognitionLike["onresult"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onend: RecognitionLike["onend"] = null;
  started = 0;
  aborted = 0;
  stopped = 0;
  capturing = false;
  ended = false;
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  abort() {
    this.aborted++;
    this.capturing = false;
    this.ended = true;
  }
  // Browser side: the person allows the microphone and capture begins.
  grant() {
    if (this.ended) return; // an aborted recogniser never starts capturing
    this.capturing = true;
    this.onstart?.();
    this.onaudiostart?.();
  }
  // Browser side: a late permission answer arriving even though we aborted.
  lateGrantIgnoringAbort() {
    this.capturing = true;
    this.onstart?.();
    this.onaudiostart?.();
  }
  say(text: string) {
    this.onresult?.({ results: [{ 0: { transcript: text } }] });
  }
  finishNaturally() {
    this.capturing = false;
    this.onaudioend?.();
    this.ended = true;
    this.onend?.();
  }
  fail(code: string) {
    this.capturing = false;
    this.onerror?.({ error: code });
    this.ended = true;
    this.onend?.();
  }
}

function setup(supported = true) {
  const made: FakeRecognition[] = [];
  const views: VoiceView[] = [];
  let transcript = "";
  const session = new VoiceSession(
    supported ? () => { const r = new FakeRecognition(); made.push(r); return r; } : null,
    { onChange: (v) => views.push(v), onTranscript: (t) => { transcript = t; } },
  );
  return { session, made, views, text: () => transcript };
}

describe("voice session: starting", () => {
  it("does nothing until start is called", () => {
    const { session, made } = setup();
    expect(made).toHaveLength(0);
    expect(session.state.phase).toBe("idle");
  });

  it("waits for permission, then listens once capture begins", () => {
    const { session, made } = setup();
    expect(session.start("")).toBe(true);
    expect(session.state.phase).toBe("requesting");
    made[0].grant();
    expect(session.state.phase).toBe("listening");
  });

  it("ignores rapid repeated starts, so only one session opens", () => {
    const { session, made } = setup();
    session.start("");
    expect(session.start("")).toBe(false);
    expect(session.start("")).toBe(false);
    made[0].grant();
    expect(session.start("")).toBe(false);
    expect(made).toHaveLength(1);
    expect(made[0].started).toBe(1);
  });

  it("explains when the browser has no speech recognition", () => {
    const { session } = setup(false);
    expect(session.start("")).toBe(false);
    expect(session.state).toMatchObject({ phase: "error", error: VOICE_MESSAGES.unsupported });
  });
});

describe("voice session: releasing the microphone", () => {
  it("Stop ends capture straight away and keeps the words", () => {
    const { session, made, text } = setup();
    session.start("");
    made[0].grant();
    made[0].say("refund for BK-1042");
    session.stop();
    expect(made[0].capturing).toBe(false);
    expect(made[0].aborted).toBe(1);
    expect(session.active).toBe(false);
    expect(session.state.phase).toBe("idle");
    expect(text()).toBe("refund for BK-1042");
  });

  it("adds new words after text already in the box", () => {
    const { session, made, text } = setup();
    session.start("Hello");
    made[0].grant();
    made[0].say("there");
    expect(text()).toBe("Hello there");
  });

  it("says so when Stop is pressed before anything was heard", () => {
    const { session, made } = setup();
    session.start("");
    made[0].grant();
    session.stop();
    expect(session.state).toMatchObject({ phase: "error", error: VOICE_MESSAGES.nothingCaught });
    expect(made[0].capturing).toBe(false);
  });

  it("releases when the browser finishes on its own, without restarting", () => {
    const { session, made } = setup();
    session.start("");
    made[0].grant();
    made[0].say("hello");
    made[0].finishNaturally();
    expect(session.active).toBe(false);
    expect(session.state.phase).toBe("idle");
    expect(made).toHaveLength(1);
    expect(made[0].started).toBe(1);
  });

  it("shows capture ending before the session closes", () => {
    const { session, made } = setup();
    session.start("");
    made[0].grant();
    made[0].onaudioend?.();
    expect(session.state.phase).toBe("finishing");
  });

  it("release is safe to call many times", () => {
    const { session, made } = setup();
    session.start("");
    made[0].grant();
    session.release();
    session.release();
    session.stop();
    session.dispose();
    session.dispose();
    expect(made[0].aborted).toBe(1);
    expect(session.state.phase).toBe("idle");
  });

  it("needs a fresh start after a release", () => {
    const { session, made } = setup();
    session.start("");
    made[0].grant();
    session.release();
    expect(session.start("")).toBe(true);
    expect(made).toHaveLength(2);
  });
});

describe("voice session: cancelling while permission is pending", () => {
  it("never listens if permission arrives after Cancel", () => {
    const { session, made } = setup();
    session.start("");
    session.release();
    made[0].grant();
    expect(made[0].capturing).toBe(false);
    expect(session.state.phase).toBe("idle");
  });

  it("shuts down capture that starts late anyway", () => {
    const { session, made, views } = setup();
    session.start("");
    session.release();
    const before = views.length;
    made[0].lateGrantIgnoringAbort();
    expect(made[0].capturing).toBe(false);
    expect(made[0].aborted).toBeGreaterThanOrEqual(2);
    expect(views.length).toBe(before);
    expect(session.state.phase).toBe("idle");
  });

  it("Stop while waiting cancels without an error", () => {
    const { session, made } = setup();
    session.start("");
    session.stop();
    expect(session.state).toMatchObject({ phase: "idle", error: null });
    expect(made[0].aborted).toBe(1);
  });

  it("ignores late results from an ended session", () => {
    const { session, made, text } = setup();
    session.start("");
    made[0].grant();
    made[0].say("first");
    session.release();
    made[0].say("should not appear");
    expect(text()).toBe("first");
  });

  it("disposing during the wait releases and stays quiet afterwards", () => {
    const { session, made, views } = setup();
    session.start("");
    session.dispose();
    const before = views.length;
    made[0].lateGrantIgnoringAbort();
    expect(made[0].capturing).toBe(false);
    expect(views.length).toBe(before);
    expect(session.start("")).toBe(false);
  });
});

describe("voice session: errors", () => {
  it.each([
    ["not-allowed", VOICE_MESSAGES.blocked],
    ["service-not-allowed", VOICE_MESSAGES.blocked],
    ["audio-capture", VOICE_MESSAGES.noMic],
    ["network", VOICE_MESSAGES.network],
    ["no-speech", VOICE_MESSAGES.noSpeech],
  ])("%s releases the microphone and explains", (code, message) => {
    const { session, made } = setup();
    session.start("");
    made[0].grant();
    made[0].fail(code);
    expect(made[0].capturing).toBe(false);
    expect(made[0].aborted).toBeGreaterThanOrEqual(1);
    expect(session.active).toBe(false);
    expect(session.state).toMatchObject({ phase: "error", error: message });
  });

  it("permission denied before capture leaves nothing running", () => {
    const { session, made } = setup();
    session.start("");
    made[0].fail("not-allowed");
    expect(session.active).toBe(false);
    expect(session.state.error).toBe(VOICE_MESSAGES.blocked);
    expect(session.start("")).toBe(true);
  });

  it("an error that throws on start is cleaned up", () => {
    const made: FakeRecognition[] = [];
    const session = new VoiceSession(() => {
      const r = new FakeRecognition();
      r.start = () => { throw new Error("busy"); };
      made.push(r);
      return r;
    }, { onChange: () => undefined, onTranscript: () => undefined });
    expect(session.start("")).toBe(false);
    expect(session.active).toBe(false);
    expect(made[0].aborted).toBe(1);
    expect(session.state.error).toBe(VOICE_MESSAGES.failed);
  });

  it("release clears an error back to idle", () => {
    const { session, made } = setup();
    session.start("");
    made[0].fail("network");
    session.release();
    expect(session.state).toMatchObject({ phase: "idle", error: null });
  });
});
