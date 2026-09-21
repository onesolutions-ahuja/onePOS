/*
 * JARVIS voice input - browser/device speech recognition (single-shot).
 *
 * Scope rules for this module:
 *   - NO wake word ("Hey JARVIS"): the operator starts and stops the
 *     microphone explicitly from the JARVIS panel.
 *   - NEVER continuously listening: `continuous` is false, one utterance per
 *     activation, and the recogniser is torn down in onend. There is no
 *     restart loop and no timer that re-opens the microphone.
 *   - NO audio upload: recognised TEXT is returned to the panel and placed in
 *     the normal text field. Speech never goes to JARVIS/Gemini as audio -
 *     the flow stays voice -> text -> POST /api/jarvis.
 *
 * The module is DOM-free (everything is taken from an injectable global), so
 * it is unit-testable in Node with a fake SpeechRecognition implementation.
 */

export const SPEECH_UNSUPPORTED_MESSAGE =
  "Voice input isn't available in this browser. Type your question instead.";

/** SpeechRecognition constructor, when the device offers it. */
export function getSpeechRecognitionCtor(globalObject = globalThis) {
  if (!globalObject) return null;
  const ctor = globalObject.SpeechRecognition || globalObject.webkitSpeechRecognition;
  return typeof ctor === "function" ? ctor : null;
}

export function isSpeechRecognitionSupported(globalObject = globalThis) {
  return getSpeechRecognitionCtor(globalObject) !== null;
}

/** Human-readable text for the browser's SpeechRecognition error codes. */
export function describeSpeechError(code) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it for this site and try again - or type your question.";
    case "no-speech":
      return "I didn't catch that. Try again - or type your question.";
    case "audio-capture":
      return "No microphone was found on this device. Type your question instead.";
    case "network":
      return "Speech recognition needs a network connection. Type your question instead.";
    case "language-not-supported":
      return "That language isn't supported for voice input. Type your question instead.";
    case "aborted":
      /* The panel/listener stopped it deliberately - nothing to report. */
      return "";
    default:
      return "Voice input stopped unexpectedly. Try again - or type your question.";
  }
}

/** The recognition language: the page's language, else the device's. */
export function resolveSpeechLanguage(globalObject = globalThis) {
  const documentLanguage = globalObject?.document?.documentElement?.lang;
  if (typeof documentLanguage === "string" && documentLanguage.trim()) return documentLanguage.trim();
  const navigatorLanguage = globalObject?.navigator?.language;
  if (typeof navigatorLanguage === "string" && navigatorLanguage.trim()) return navigatorLanguage.trim();
  return "en-GB";
}

/**
 * A one-utterance recogniser.
 *
 * @returns {{
 *   supported: boolean,
 *   start: () => boolean,
 *   stop: () => void,
 *   abort: () => void,
 *   isListening: () => boolean
 * }}
 */
export function createSpeechRecognizer({
  globalObject = globalThis,
  language = null,
  onStart,
  onInterim,
  onTranscript,
  onError,
  onEnd,
} = {}) {
  const Ctor = getSpeechRecognitionCtor(globalObject);

  if (!Ctor) {
    return {
      supported: false,
      /* A no-op surface so callers can use one code path; the panel shows
         SPEECH_UNSUPPORTED_MESSAGE and keeps text input fully usable. */
      start: () => false,
      stop: () => {},
      abort: () => {},
      isListening: () => false,
    };
  }

  let recognition = null;
  let listening = false;

  const teardown = () => {
    listening = false;
    recognition = null;
  };

  const start = () => {
    /* Double-start guarded: no second microphone session can be opened. */
    if (listening) return true;

    const instance = new Ctor();
    instance.lang = language || resolveSpeechLanguage(globalObject);
    /* One utterance per activation - never a continuous listener. Interim
       results give live feedback in the text field; the final transcript
       replaces them so the operator reviews/edits before sending. */
    instance.continuous = false;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      onStart?.();
    };

    instance.onresult = (event) => {
      let transcript = "";
      let isFinal = false;
      const results = event?.results || [];
      for (let index = event?.resultIndex || 0; index < results.length; index += 1) {
        const result = results[index];
        const alternative = result?.[0];
        if (alternative?.transcript) transcript += alternative.transcript;
        if (result?.isFinal) isFinal = true;
      }
      const text = transcript.trim();
      if (!text) return;
      if (isFinal) {
        onTranscript?.(text);
        /* End the microphone as soon as the utterance is final. */
        try { instance.stop(); } catch { /* already stopping */ }
      } else {
        onInterim?.(text);
      }
    };

    instance.onerror = (event) => {
      const code = event?.error || "unknown";
      const message = describeSpeechError(code);
      if (message) onError?.({ code, message });
    };

    instance.onend = () => {
      teardown();
      onEnd?.();
    };

    listening = true;
    recognition = instance;
    try {
      instance.start();
    } catch (error) {
      teardown();
      onError?.({
        code: "start-failed",
        message: "Voice input couldn't start on this device. Type your question instead.",
      });
      onEnd?.();
      return false;
    }
    return true;
  };

  const stop = () => {
    if (recognition && listening) {
      try { recognition.stop(); } catch { /* already stopping */ }
    }
  };

  const abort = () => {
    const instance = recognition;
    teardown();
    if (instance) {
      try { instance.abort(); } catch { /* already closed */ }
    }
  };

  return { supported: true, start, stop, abort, isListening: () => listening };
}
