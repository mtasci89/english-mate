import { useEffect, useRef, useState } from "react";

import { cancelSpeech, speak, speakRemote } from "../audio/player";
import { createRecognizer, type Recognizer } from "../speech/recognition";
import { recordGaps } from "../curriculum/gaps";
import { logAttempt, sessionId } from "../telemetry";
import type { EngineState, Message, Settings, Speakable } from "../types";

type Props = {
  settings: Settings;
  onExit: () => void;
};

const starters: Record<Settings["topic"], string[]> = {
  daily: ["What did you do today?", "Tell me about something you like.", "What do you want to eat?"],
  school: ["What did you learn at school?", "Tell me about your teacher.", "What is in your school bag?"],
  family: ["Who is at home with you?", "Tell me about your family.", "What do you do with your dad?"],
  feelings: ["How do you feel today?", "What makes you happy?", "When do you feel excited?"],
};

function nextStarter(topic: Settings["topic"], count: number) {
  const list = starters[topic];
  return list[count % list.length];
}

/**
 * Free conversation, still powered by Gemini.
 *
 * This is the only mode where a model sits between the child speaking and the
 * toy answering, and it stays that way because open conversation cannot be
 * pre-rendered. The structured games carry the daily practice; this one is the
 * reward at the top of the ladder.
 */
export function ChatScreen({ settings, onExit }: Props) {
  const [engineState, setEngineState] = useState<EngineState>("ready");
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi. I am here. Tell me anything you want.", lang: "en" },
  ]);
  const [micDenied, setMicDenied] = useState(false);
  /** Set when replies are coming from the offline rotation instead of the model. */
  const [degraded, setDegraded] = useState<string | null>(null);
  const [lifelineText, setLifelineText] = useState<string | null>(null);

  const messagesRef = useRef(messages);
  const recognizerRef = useRef<Recognizer | null>(null);
  const activeRef = useRef(true);

  messagesRef.current = messages;

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      cancelSpeech();
      recognizerRef.current?.cancel();
    };
  }, []);

  const childTurns = messages.filter((message) => message.role === "child").length;
  const lastAssistant = messages.filter((message) => message.role === "assistant").at(-1);

  // Cloud TTS first so the reply sounds like the same character as the cached
  // prompts; the browser voice stays as the fallback, not the default.
  async function say(speakable: Speakable) {
    setEngineState("speaking");
    const played = await speakRemote(speakable);
    if (!played) await speak(speakable);
    if (activeRef.current) setEngineState("ready");
  }

  /*
   * The offline reply.
   *
   * This used to prepend "I understand." to a question drawn from a fixed
   * rotation, which is exactly what a broken conversation sounds like — and
   * because it was silent, a missing API key looked like the product working
   * badly rather than a configuration fault. It no longer imitates a reply, and
   * `degraded` puts the real reason on screen.
   */
  function fallbackReply(): Speakable {
    return { text: nextStarter(settings.topic, childTurns), lang: "en" };
  }

  async function respondTo(input: string, history: Message[]) {
    setEngineState("thinking");
    const startedAt = Date.now();

    let reply: Speakable;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input, settings, messages: history }),
      });
      if (!response.ok) {
        // The server says exactly what went wrong — a missing key, a retired
        // model, a spent quota. Guessing from a bare status code cost a round
        // of debugging, so the reason is carried through to the screen.
        const problem = (await response.json().catch(() => null)) as
          | { error?: string; detail?: string }
          | null;
        throw new Error(problem?.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as { text: string; lang?: "en" | "tr" };
      reply = { text: data.text, lang: data.lang ?? "en" };
      setDegraded(null);
    } catch (error) {
      reply = fallbackReply();
      const reason = error instanceof Error ? error.message : "unreachable";
      setDegraded(`Replies are canned — the conversation service failed: ${reason}`);
    }

    if (!activeRef.current) return;

    logAttempt({
      ts: Date.now(),
      sessionId: sessionId(),
      game: "chat",
      itemKey: settings.topic,
      target: null,
      heard: input || null,
      accepted: Boolean(input),
      score: null,
      trLifeline: false,
      hintLevel: 0,
      latencyMs: Date.now() - startedAt,
    });

    setMessages((current) => [...current, { role: "assistant", ...reply }]);
    // Fire and forget, after the reply is on its way: the words the child
    // reached for in Turkish are the best evidence of what Name It should
    // drill next, and collecting them must not delay the conversation.
    void captureGaps(input);
    await say(reply);
  }

  async function captureGaps(input: string) {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "gaps", text: input }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { gaps?: { tr: string; en: string }[] };
      if (data.gaps?.length) recordGaps(data.gaps);
    } catch {
      // Losing a gap costs nothing a later conversation will not offer again.
    }
  }

  function handleFinal(text: string) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) {
      setEngineState("ready");
      return;
    }

    const history = [...messagesRef.current, { role: "child" as const, text: clean, lang: "en" as const }];
    setTranscript(clean);
    setMessages(history);
    setLifelineText(null);
    void respondTo(clean, history.slice(-8));
  }

  /*
   * The Turkish lifeline.
   *
   * K5 says Turkish is a step, not an exit: the child hears what the sentence
   * actually meant, then hears the English again and still owes an English
   * answer. Saying "Şöyle sordum:" and repeating the same English sentence —
   * which is what this did — helped nobody, because the sentence was never the
   * part that was understood.
   */
  async function useLifeline() {
    const english = lastAssistant?.text;
    if (!english) return;

    setEngineState("thinking");
    let turkish: string | null = null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "translate", text: english }),
      });
      if (response.ok) {
        const data = (await response.json()) as { text?: string };
        turkish = data.text ?? null;
      }
    } catch {
      // Falls through to the English-only path below.
    }

    if (!activeRef.current) return;

    setLifelineText(turkish);
    if (turkish) await say({ text: turkish, lang: "tr" });
    // English always closes the turn, translated or not.
    await say({ text: english, lang: "en" });
  }

  // Built once and armed while the toy waits, so pressing and speaking straight
  // away does not lose the first word to engine start-up.
  const handleFinalRef = useRef(handleFinal);
  handleFinalRef.current = handleFinal;

  useEffect(() => {
    const recognizer = createRecognizer({
      lang: "en-US",
      onPartial: setTranscript,
      onFinal: (text) => {
        if (activeRef.current) handleFinalRef.current(text);
      },
      onDenied: () => {
        setMicDenied(true);
        setEngineState("ready");
      },
    });

    recognizerRef.current = recognizer;
    return () => recognizer.cancel();
  }, []);

  useEffect(() => {
    if (engineState === "ready" && !micDenied) recognizerRef.current?.arm();
  }, [engineState, micDenied]);

  function startListening() {
    if (engineState === "listening") return;

    cancelSpeech();
    setTranscript("");
    setEngineState("listening");
    recognizerRef.current?.start();
  }

  const busy = engineState === "speaking" || engineState === "thinking";

  return (
    <section className="game-screen" aria-label="Talk with me">
      <header className="game-header">
        <button type="button" className="ghost-button" onClick={onExit}>
          ← Back
        </button>
        <span className={`engine-pill ${engineState}`}>{engineState}</span>
        <span className="round-counter">💬</span>
      </header>

      <div className="game-stage">
        <p className="game-prompt">{lastAssistant?.text}</p>
      </div>

      <button
        type="button"
        className={`primary-talk talk-button ${engineState === "listening" ? "active" : ""}`}
        disabled={busy || micDenied}
        onPointerDown={startListening}
        onPointerUp={() => recognizerRef.current?.stop()}
        onPointerCancel={() => recognizerRef.current?.stop()}
      >
        <span className="mic-icon" aria-hidden="true" />
        {engineState === "listening" ? "Keep talking…" : "Hold and talk"}
      </button>

      {lifelineText && <p className="lifeline-text">{lifelineText}</p>}

      <p className="heard-line">{transcript || " "}</p>

      <div className="helper-row">
        <button
          type="button"
          className="ghost-button"
          disabled={busy}
          onClick={() => lastAssistant && void say(lastAssistant)}
        >
          Say it again
        </button>
        <button
          type="button"
          className="lifeline-button"
          disabled={busy || !settings.turkishBridge}
          onClick={() => void useLifeline()}
        >
          Anlamadım
        </button>
      </div>

      {degraded && <p className="browser-note">{degraded}</p>}

      {micDenied && (
        <p className="browser-note">
          Microphone permission is blocked. Allow it in the browser settings, then reload.
        </p>
      )}
    </section>
  );
}
