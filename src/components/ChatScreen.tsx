import { useEffect, useRef, useState } from "react";

import { cancelSpeech, speak } from "../audio/player";
import { createRecognizer, type Recognizer } from "../speech/recognition";
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

  async function say(speakable: Speakable) {
    setEngineState("speaking");
    await speak(speakable);
    if (activeRef.current) setEngineState("ready");
  }

  function fallbackReply(input: string): Speakable {
    const starter = nextStarter(settings.topic, childTurns);
    if (!input) return { text: starter, lang: "en" };
    return { text: `I understand. ${starter}`, lang: "en" };
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
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { text: string; lang?: "en" | "tr" };
      reply = { text: data.text, lang: data.lang ?? "en" };
    } catch {
      reply = fallbackReply(input);
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
    await say(reply);
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
    void respondTo(clean, history.slice(-8));
  }

  function startListening() {
    if (engineState === "listening") return;

    cancelSpeech();
    setTranscript("");
    setEngineState("listening");

    const recognizer = createRecognizer({
      lang: "en-US",
      onPartial: setTranscript,
      onFinal: (text) => {
        if (activeRef.current) handleFinal(text);
      },
      onDenied: () => {
        setMicDenied(true);
        setEngineState("ready");
      },
    });

    recognizerRef.current = recognizer;
    recognizer.start();
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
          onClick={() => {
            const english = lastAssistant?.text ?? "";
            void (async () => {
              await say({ text: "Şöyle sordum:", lang: "tr" });
              if (english) await say({ text: english, lang: "en" });
            })();
          }}
        >
          Anlamadım
        </button>
      </div>

      {micDenied && (
        <p className="browser-note">
          Microphone permission is blocked. Allow it in the browser settings, then reload.
        </p>
      )}
    </section>
  );
}
