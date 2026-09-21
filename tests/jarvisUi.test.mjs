/*
 * JARVIS assistant UI - tests.
 *
 * The voice/microphone boundary cannot run headless, so — following the repo
 * convention (tests/posCodeScanner.test.mjs) — tests target the seams:
 *
 *   - services/jarvis.js (pure): validation, error contract, status mapping
 *   - services/speechRecognition.js (pure, injectable global): no wake word,
 *     never continuous, transcript goes to the TEXT field, teardown on unmount
 *   - static source checks: orb is not a mic button, panel uses the existing
 *     apiRequest auth wrapper, no key/audio ever leaves the client
 *
 *   node --test tests/jarvisUi.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

import {
  JARVIS_MAX_MESSAGE_LENGTH,
  askJarvis,
  describeJarvisError,
  isRetryableJarvisError,
  validateJarvisQuestion,
} from "../src/services/jarvis.js";
import {
  SPEECH_UNSUPPORTED_MESSAGE,
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
  resolveSpeechLanguage,
} from "../src/services/speechRecognition.js";

/* ---------------------------------------------------------- services/jarvis */

test("question validation: trims, enforces the backend length limit, rejects empty", () => {
  assert.equal(validateJarvisQuestion("  What is onePOS?  ").question, "What is onePOS?");
  assert.equal(validateJarvisQuestion("   ").ok, false);
  assert.equal(validateJarvisQuestion(null).ok, false);
  const long = "x".repeat(JARVIS_MAX_MESSAGE_LENGTH + 1);
  assert.equal(validateJarvisQuestion(long).ok, false);
  assert.equal(
    validateJarvisQuestion("x".repeat(JARVIS_MAX_MESSAGE_LENGTH)).ok,
    true,
    "exactly the backend limit is accepted",
  );
});

test("askJarvis posts through the EXISTING apiRequest wrapper with the backend contract", async () => {
  const calls = [];
  const original = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, token: options.headers.Authorization });
    return new Response(
      JSON.stringify({ success: true, data: { answer: "onePOS is a point-of-sale system.", provider: "gemini", model: "m", latencyMs: 10 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  globalThis.localStorage = { getItem: () => "test-jwt-token" };
  try {
    const reply = await askJarvis("What is onePOS?");
    assert.equal(reply.answer, "onePOS is a point-of-sale system.");
    assert.equal(reply.provider, "gemini");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/api/jarvis"), "hits the existing backend endpoint");
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].options.body), { message: "What is onePOS?" });
    assert.equal(calls[0].token, "Bearer test-jwt-token", "uses the existing onepos_token auth");
  } finally {
    globalThis.fetch = original;
    globalThis.localStorage = originalStorage;
  }
});

test("askJarvis maps backend failure codes onto error.code for the panel", async () => {
  const original = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: false, code: "provider_timeout" }), { status: 504 });
  globalThis.localStorage = { getItem: () => "t" };
  try {
    await assert.rejects(
      () => askJarvis("hi"),
      (error) => error.code === "provider_timeout",
    );
  } finally {
    globalThis.fetch = original;
    globalThis.localStorage = originalStorage;
  }
});

test("errors surface as human text and never leak internals", () => {
  assert.equal(
    describeJarvisError(Object.assign(new Error("x"), { code: "provider_timeout" })),
    "JARVIS took too long to answer. Try again, or ask a shorter question.",
  );
  assert.match(describeJarvisError(Object.assign(new Error("x"), { status: 401 })), /sign in/i);
  assert.ok(!describeJarvisError(new TypeError("fetch failed")).includes("fetch"), "network TypeError gets a friendly message");
  assert.equal(isRetryableJarvisError({ code: "provider_timeout" }), true);
  assert.equal(isRetryableJarvisError({ code: "AUTH_REQUIRED" }), false);
});

/* -------------------------------------------------- services/speechRecognition */

function makeFakeRecognition() {
  const instances = [];
  class FakeSpeechRecognition {
    constructor() {
      this.continuous = undefined;
      this.interimResults = undefined;
      instances.push(this);
    }
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; this.onend?.(); }
    /* test helper: emit a recognition result */
    emit(transcript, isFinal) {
      this.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript }, isFinal, length: 1, length2: undefined }],
      });
    }
  }
  return { FakeSpeechRecognition, instances };
}

test("speech recognition: supported only when the device offers it", () => {
  assert.equal(isSpeechRecognitionSupported({}), false);
  const { FakeSpeechRecognition } = makeFakeRecognition();
  assert.equal(isSpeechRecognitionSupported({ SpeechRecognition: FakeSpeechRecognition }), true);
});

test("speech recognition: single-shot — never continuous, no restart loop", () => {
  const { FakeSpeechRecognition, instances } = makeFakeRecognition();
  const recognizer = createSpeechRecognizer({ globalObject: { SpeechRecognition: FakeSpeechRecognition } });
  assert.equal(recognizer.start(), true);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].continuous, false, "continuous MUST be false");
  assert.equal(recognizer.start(), true, "double-start is guarded");
  assert.equal(instances.length, 1, "no second session opened");
  recognizer.stop();
});

test("speech recognition: transcript lands in the TEXT field for review (not sent as audio)", () => {
  const { FakeSpeechRecognition, instances } = makeFakeRecognition();
  const seen = { interim: [], final: [], errors: [] };
  const recognizer = createSpeechRecognizer({
    globalObject: { SpeechRecognition: FakeSpeechRecognition },
    onInterim: (t) => seen.interim.push(t),
    onTranscript: (t) => seen.final.push(t),
    onError: (e) => seen.errors.push(e),
  });
  recognizer.start();
  const instance = instances[0];
  instance.emit("what were todays sales", false);
  assert.deepEqual(seen.interim, ["what were todays sales"]);
  instance.emit("what were today's sales?", true);
  assert.deepEqual(seen.final, ["what were today's sales?"], "final transcript replaces interim for review");
  assert.equal(seen.errors.length, 0);
  recognizer.stop();
});

test("speech recognition: teardown on stop/abort so the mic never outlives the panel", () => {
  const { FakeSpeechRecognition, instances } = makeFakeRecognition();
  const recognizer = createSpeechRecognizer({ globalObject: { SpeechRecognition: FakeSpeechRecognition } });
  recognizer.start();
  recognizer.abort();
  assert.ok(instances[0].aborted, "abort reaches the recogniser");
  assert.equal(recognizer.isListening(), false);
});

test("speech recognition: unsupported devices get a clear message and text stays usable", () => {
  const recognizer = createSpeechRecognizer({ globalObject: {} });
  assert.equal(recognizer.supported, false);
  assert.equal(recognizer.start(), false, "start is a safe no-op");
  assert.ok(SPEECH_UNSUPPORTED_MESSAGE.length > 20, "panel has an honest unsupported message");
});

test("speech recognition: no wake word, no auto-restart, language from the document", () => {
  const { FakeSpeechRecognition, instances } = makeFakeRecognition();
  const recognizer = createSpeechRecognizer({
    globalObject: { SpeechRecognition: FakeSpeechRecognition, document: { documentElement: { lang: "en-GB" } } },
  });
  recognizer.start();
  assert.equal(instances[0].lang, "en-GB");
  assert.equal(resolveSpeechLanguage({ navigator: { language: "cy-GB" } }), "cy-GB");
  /* Source-level guarantees: no continuous listening and no wake-word timer.
     Comments are stripped so documentation mentioning "Hey JARVIS" as an
     explicitly-excluded feature doesn't trip the check. */
  const src = read("../src/services/speechRecognition.js");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(code.includes("continuous = false"), "never sets continuous true");
  assert.ok(!code.includes("continuous = true"));
  assert.ok(!/setInterval|setTimeout\([^)]*start/i.test(code), "no restart timer");
  assert.ok(!code.toLowerCase().includes("hey jarvis"), "no wake word in code");
});

/* ----------------------------------------------------------- static source checks */

const POS_SRC = read("../src/pages/pos/POS.jsx");
const ORB_SRC = read("../src/components/jarvis/JarvisOrb.jsx");
const PANEL_SRC = read("../src/components/jarvis/JarvisPanel.jsx");
const STYLES_SRC = read("../src/components/jarvis/JarvisStyles.jsx");
const CLIENT_SRC = read("../src/services/jarvis.js");

test("the orb is an AI presence, NOT a microphone button", () => {
  assert.ok(ORB_SRC.includes("jarvis-orb-core"), "layered orb presence");
  assert.ok(ORB_SRC.includes("JARVIS"), "labelled so staff can find it");
  assert.ok(!ORB_SRC.includes("lucide-react"), "no mic icon on the primary visual");
  assert.ok(ORB_SRC.includes('aria-haspopup="dialog"'), "opens the panel dialog");
  assert.ok(STYLES_SRC.includes("prefers-reduced-motion"), "respects motion preferences");
  assert.ok(ORB_SRC.includes("z-40"), "sits below the z-50 modals/till surfaces");
});

test("the panel wires into the EXISTING POS screen without redesigning it", () => {
  assert.ok(POS_SRC.includes("components/jarvis/JarvisOrb.jsx"), "orb mounted in POS");
  assert.ok(POS_SRC.includes("components/jarvis/JarvisPanel.jsx"), "panel mounted in POS");
  assert.ok(PANEL_SRC.includes('role="dialog"'), "panel is a dialog");
  assert.ok(PANEL_SRC.includes("jarvis-thinking"), "loading state rendered");
  assert.ok(PANEL_SRC.includes('role="alert"'), "errors surfaced clearly");
  assert.ok(PANEL_SRC.includes("jarvis-retry"), "retryable failures offer retry");
  assert.ok(PANEL_SRC.includes("ask(suggestion)"), "operator can ask again without closing");
});

test("voice stays voice → text → /api/jarvis: no audio upload, no provider calls", () => {
  for (const [name, src] of [["panel", PANEL_SRC], ["client", CLIENT_SRC], ["speech", read("../src/services/speechRecognition.js")]]) {
    assert.ok(!/MediaRecorder|getUserMedia|FormData|audio\/wav/.test(src), `${name}: no microphone audio captured/uploaded`);
    assert.ok(!/generativelanguage|openai/i.test(src), `${name}: never talks to an AI provider directly`);
  }
  assert.ok(PANEL_SRC.includes("onTranscript"), "recognised speech becomes text");
  assert.ok(PANEL_SRC.includes("Review what you said"), "operator reviews the transcript before sending");
  assert.ok(CLIENT_SRC.includes('apiRequest("/api/jarvis"'), "questions go through the existing auth wrapper");
  assert.ok(!CLIENT_SRC.includes("GEMINI_API_KEY"), "no key on the client");
  assert.ok(!CLIENT_SRC.includes("localStorage.setItem"), "client never writes tokens");
});
