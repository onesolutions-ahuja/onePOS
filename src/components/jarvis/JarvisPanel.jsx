/*
 * JARVES panel - compact assistant surface for the till.
 *
 * Two input methods, one destination:
 *   - TEXT: input + Ask -> the existing authenticated POST /api/jarvis
 *   - VOICE: device speech recognition -> recognised TEXT placed in the SAME
 *     input field for review/edit before sending. No wake word, no continuous
 *     listening, no audio upload - the flow stays voice -> text -> /api/jarvis.
 *
 * Errors surface through describeJarvisError (same contract as the backend),
 * and the operator can ask again without closing the panel.
 */
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import JarvisStyles from "./JarvisStyles.jsx";
import {
  askJarvis,
  describeJarvisError,
  isRetryableJarvisError,
  validateJarvisQuestion,
} from "../../services/jarvis.js";
import {
  SPEECH_UNSUPPORTED_MESSAGE,
  createSpeechRecognizer,
  isSpeechRecognitionSupported,
} from "../../services/speechRecognition.js";

const SUGGESTIONS = Object.freeze([
  "What is onePOS?",
  "How do I open the till session?",
  "How do offline sales sync?",
]);

export default function JarvisPanel({ onClose, onActivityChange, embedded = false }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const [listening, setListening] = useState(false);
  const [responding, setResponding] = useState(false);
  const [speechNotice, setSpeechNotice] = useState("");
  const [speechSupported] = useState(() => isSpeechRecognitionSupported());

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const recognizerRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /* One recogniser per panel; torn down with the panel so the microphone can
     never outlive the UI that opened it. */
  useEffect(() => {
    recognizerRef.current = createSpeechRecognizer({
      onStart: () => setListening(true),
      onInterim: (text) => setQuestion(text),
      onTranscript: (text) => {
        setQuestion(text);
        setSpeechNotice("Review what you said, then press Ask.");
        inputRef.current?.focus();
      },
      onError: ({ message }) => setSpeechNotice(message),
      onEnd: () => setListening(false),
    });
    return () => {
      recognizerRef.current?.abort();
      recognizerRef.current = null;
    };
  }, []);

  /* Keep the latest answer in view. */
  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [messages, loading]);

  /* Mirror the assistant's activity to the host (orb animation state):
     listening (voice capture) -> thinking (waiting for the answer) -> a short
     "response" flare when the answer lands, then smoothly back to idle. */
  useEffect(() => {
    onActivityChange?.(listening ? "listening" : loading ? "thinking" : responding ? "response" : null);
  }, [listening, loading, responding, onActivityChange]);

  /* The response state is a brief energetic moment, never a new resting state. */
  useEffect(() => {
    if (!responding) return undefined;
    const timer = setTimeout(() => setResponding(false), 1600);
    return () => clearTimeout(timer);
  }, [responding]);

  const ask = async (raw) => {
    if (loading) return;
    const validation = validateJarvisQuestion(raw);
    if (!validation.ok) {
      setError(validation.message);
      setRetryable(false);
      return;
    }

    recognizerRef.current?.abort();
    setError("");
    setRetryable(false);
    setSpeechNotice("");
    setQuestion("");
    setLastQuestion(validation.question);
    setMessages((current) => [...current, { role: "user", text: validation.question }]);
    setLoading(true);

    try {
      const reply = await askJarvis(validation.question);
      setMessages((current) => [...current, { role: "assistant", text: reply.answer }]);
      /* Short "here you go" flare on the orb; cleared by the timer above. */
      setResponding(true);
    } catch (askError) {
      setError(describeJarvisError(askError));
      setRetryable(isRetryableJarvisError(askError));
      setQuestion(validation.question);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const toggleVoice = () => {
    const recognizer = recognizerRef.current;
    if (!recognizer?.supported) {
      setSpeechNotice(SPEECH_UNSUPPORTED_MESSAGE);
      return;
    }
    if (listening) {
      recognizer.stop();
      setListening(false);
      return;
    }
    setError("");
    setSpeechNotice("");
    if (!recognizer.start()) setListening(false);
  };

  return (
    <div
      className={`jarvis-panel-overlay fixed inset-0 flex items-end justify-end p-3 sm:p-5${embedded ? " jarvis-panel-overlay--dock" : ""}`}
      data-testid="jarvis-panel-overlay"
    >
      <button
        type="button"
        aria-label="Close JARVES"
        onClick={onClose}
        className="jarvis-panel-backdrop absolute inset-0 bg-black/40"
        data-testid="jarvis-panel-backdrop"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="JARVES assistant"
        data-testid="jarvis-panel"
        className="relative w-full sm:w-[420px] max-h-[78dvh] flex flex-col rounded-2xl border border-white/15 bg-[rgba(8,13,17,0.92)] text-slate-100 shadow-[0_24px_70px_rgba(2,6,16,0.6)] backdrop-blur-xl overflow-hidden"
      >
        <JarvisStyles />

        <header className="flex items-center gap-2.5 px-4 py-3 border-b border-white/10 bg-[rgba(10,20,26,0.95)] text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
          <span className="w-8 h-8 rounded-full shrink-0 bg-[radial-gradient(circle_at_34%_28%,#eef7f6_0%,#b0d9d5_18%,#4fa69e_42%,#176F6A_68%,#104744_100%)] ring-1 ring-white/25" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold tracking-[0.2em]">JARVES</h2>
            <p className="text-[11px] text-teal-100/90 leading-tight">onePOS AI assistant</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close JARVES"
            title="Close"
            data-testid="jarvis-panel-close"
            className="p-1.5 rounded-lg text-teal-100/80 hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[radial-gradient(circle_at_50%_0%,rgba(23,111,106,0.24),rgba(8,13,17,0)_58%)] bg-[color:rgba(8,13,17,0.55)]"
          data-testid="jarvis-messages"
        >
          {messages.length === 0 && !loading && (
            <div className="text-center py-3" data-testid="jarvis-empty">
              <Sparkles size={22} className="mx-auto text-emerald-300" />
              <p className="mt-1 text-sm font-semibold text-white">Ask JARVES anything about onePOS.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    className="text-xs px-2.5 py-1 rounded-full border border-teal-300/30 bg-teal-400/10 text-teal-50 hover:bg-teal-400/20 hover:border-teal-200/40 transition-colors"
                    data-testid="jarvis-suggestion"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`jarvis-message flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={message.role === "user" ? "jarvis-message-user" : "jarvis-message-assistant"}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "bg-teal-600/35 text-teal-50 border border-teal-300/25 rounded-br-sm"
                    : "border border-white/12 bg-white/[0.07] text-slate-100 rounded-bl-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                }`}
              >
                {message.text}
              </div>
            </div>
          ))}

          {loading && (
            <div className="jarvis-message flex justify-start" data-testid="jarvis-thinking" aria-live="polite">
            <div className="bg-white/[0.07] border border-white/12 rounded-2xl rounded-bl-sm px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] flex items-center gap-1">
              <span className="jarvis-dot w-1.5 h-1.5 rounded-full bg-emerald-300 inline-block" />
              <span className="jarvis-dot w-1.5 h-1.5 rounded-full bg-emerald-300 inline-block" />
              <span className="jarvis-dot w-1.5 h-1.5 rounded-full bg-emerald-300 inline-block" />
              </div>
            </div>
          )}
        </div>

        {(error || speechNotice) && (
          <div className="px-4 py-2" data-testid="jarvis-notice" role="alert" aria-live="assertive">
            {error && (
              <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
                <span className="flex-1">{error}</span>
                {retryable && lastQuestion && (
                  <button
                    type="button"
                    onClick={() => ask(lastQuestion)}
                    className="font-semibold underline shrink-0"
                    data-testid="jarvis-retry"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            {speechNotice && (
              <div className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                {speechNotice}
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask(question);
          }}
          className="flex items-end gap-2 px-3 py-3 border-t border-white/10 bg-[rgba(7,12,16,0.95)]"
          data-testid="jarvis-form"
        >
          <button
            type="button"
            onClick={toggleVoice}
            aria-pressed={listening}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            title={listening ? "Stop listening" : "Speak your question"}
            data-testid="jarvis-mic"
            data-listening={listening}
            className={`jarvis-mic shrink-0 w-10 h-10 rounded-full flex items-center justify-center border ${
              listening
                ? "jarvis-mic--listening bg-emerald-500 border-emerald-300/60 text-white"
                : speechSupported
                  ? "bg-white/[0.08] border-white/15 text-teal-50 hover:bg-white/[0.14] hover:border-white/25"
                  : "bg-slate-800 border-white/10 text-slate-500"
            }`}
          >
            {listening ? <Mic size={18} /> : <MicOff size={18} className={speechSupported ? "hidden" : ""} />}
            {speechSupported && !listening && <Mic size={18} className={listening ? "hidden" : ""} />}
          </button>

          <input
            ref={inputRef}
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={listening ? "Listening…" : "Ask JARVES…"}
            maxLength={2000}
            disabled={loading}
            data-testid="jarvis-input"
            aria-label="Your question for JARVES"
            className="flex-1 min-w-0 text-sm px-3 py-2.5 rounded-xl border border-white/15 bg-white/[0.08] text-white placeholder:text-slate-300/80 focus:outline-none focus:ring-2 focus:ring-emerald-400/70 focus:border-emerald-300/60 disabled:bg-slate-800/60 disabled:text-slate-400"
          />

          <button
            type="submit"
            disabled={loading || !question.trim()}
            aria-label="Ask JARVES"
            title="Ask"
            data-testid="jarvis-ask"
            className="shrink-0 w-10 h-10 rounded-full bg-emerald-400 text-slate-950 flex items-center justify-center shadow-[0_2px_10px_rgba(52,211,153,0.45)] hover:bg-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <Send size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
