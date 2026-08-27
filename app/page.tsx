"use client";

import { useMemo, useRef, useState } from "react";

type SpeechRecognitionEvent = Event & {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: { transcript: string; confidence: number };
    };
  };
};

type SpeechRecognitionErrorEvent = Event & {
  error: string;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type Level = "early" | "sentence" | "conversation";
type CorrectionStyle = "gentle" | "balanced" | "direct";
type Topic = "daily" | "school" | "family" | "feelings";
type LanguageMode = "english" | "turkish";
type EngineState = "ready" | "listening" | "thinking" | "speaking";

type Message = {
  role: "child" | "assistant";
  text: string;
  lang: "en" | "tr";
};

type Settings = {
  childName: string;
  level: Level;
  topic: Topic;
  correctionStyle: CorrectionStyle;
  turkishBridge: boolean;
};

const STORAGE_KEY = "english-mate-voice-settings";

const levelLabels: Record<Level, string> = {
  early: "Word to phrase",
  sentence: "Full sentences",
  conversation: "Small conversation",
};

const topicLabels: Record<Topic, string> = {
  daily: "Daily life",
  school: "School",
  family: "Family",
  feelings: "Feelings",
};

const correctionLabels: Record<CorrectionStyle, string> = {
  gentle: "Gentle",
  balanced: "Balanced",
  direct: "Direct",
};

const starters: Record<Topic, string[]> = {
  daily: [
    "What did you do today?",
    "Tell me about something you like.",
    "What do you want to eat?",
  ],
  school: [
    "What did you learn at school?",
    "Tell me about your teacher.",
    "What is in your school bag?",
  ],
  family: [
    "Who is at home with you?",
    "Tell me about your family.",
    "What do you do with your dad?",
  ],
  feelings: [
    "How do you feel today?",
    "What makes you happy?",
    "When do you feel excited?",
  ],
};

const turkishSignals = [
  "bilmiyorum",
  "anlamadım",
  "yardım",
  "yardim",
  "ne demek",
  "nasıl söylenir",
  "nasil soylenir",
  "türkçe",
  "turkce",
  "zor",
];

function defaultSettings(): Settings {
  return {
    childName: "My child",
    level: "sentence",
    topic: "daily",
    correctionStyle: "balanced",
    turkishBridge: true,
  };
}

function readSettings() {
  if (typeof window === "undefined") return defaultSettings();

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultSettings();

  try {
    return { ...defaultSettings(), ...(JSON.parse(stored) as Partial<Settings>) };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return defaultSettings();
  }
}

function normalize(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function looksTurkish(text: string) {
  const lower = text.toLocaleLowerCase("tr-TR");
  return /[çğıöşü]/i.test(text) || turkishSignals.some((signal) => lower.includes(signal));
}

function nextStarter(topic: Topic, count: number) {
  const list = starters[topic];
  return list[count % list.length];
}

function buildResponse(input: string, settings: Settings, turnCount: number) {
  const cleanInput = normalize(input);
  const isTurkish = looksTurkish(cleanInput);
  const starter = nextStarter(settings.topic, turnCount);

  if (!cleanInput) {
    return {
      text: starter,
      lang: "en" as const,
    };
  }

  if (isTurkish && settings.turkishBridge) {
    return {
      text:
        "Anladım. Bunu kısa bir İngilizce cümleye çevirelim: " +
        starter +
        " Önce bunu söyle, sonra kendi cevabını ekle.",
      lang: "tr" as const,
    };
  }

  const words = cleanInput.split(" ");
  const shortAnswer = words.length < 4;
  const correctionLead =
    settings.correctionStyle === "direct"
      ? "Correction:"
      : settings.correctionStyle === "gentle"
        ? "Nice. A more natural way is:"
        : "Good. Try this stronger sentence:";

  if (settings.level === "early") {
    return {
      text: `${correctionLead} I ${cleanInput.toLowerCase()}. Now say it once more.`,
      lang: "en" as const,
    };
  }

  if (shortAnswer) {
    return {
      text: `${correctionLead} I can say, "${cleanInput}, please." Now answer: ${starter}`,
      lang: "en" as const,
    };
  }

  if (settings.level === "conversation") {
    return {
      text: `I understood: "${cleanInput}". Tell me one more detail. ${starter}`,
      lang: "en" as const,
    };
  }

  return {
    text: `I understood: "${cleanInput}". Now make it a little longer with because.`,
    lang: "en" as const,
  };
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [languageMode, setLanguageMode] = useState<LanguageMode>("english");
  const [engineState, setEngineState] = useState<EngineState>("ready");
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Hi. I am ready to talk. Tell me about your day.",
      lang: "en",
    },
  ]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const assistantReply = messages.filter((message) => message.role === "assistant").at(-1);
  const childTurns = messages.filter((message) => message.role === "child").length;
  const currentPrompt = useMemo(
    () => nextStarter(settings.topic, childTurns),
    [childTurns, settings.topic],
  );

  function updateSettings(next: Partial<Settings>) {
    setSettings((current) => {
      const updated = { ...current, ...next };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  function speak(text: string, lang: "en" | "tr" = "en") {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "tr" ? "tr-TR" : "en-US";
    utterance.rate = lang === "tr" ? 0.92 : 0.82;
    utterance.pitch = 1.02;
    utterance.onstart = () => setEngineState("speaking");
    utterance.onend = () => setEngineState("ready");
    window.speechSynthesis.speak(utterance);
  }

  function addAssistantResponse(input: string) {
    setEngineState("thinking");
    window.setTimeout(() => {
      const response = buildResponse(input, settings, childTurns);
      setMessages((current) => [
        ...current.slice(-7),
        { role: "assistant", text: response.text, lang: response.lang },
      ]);
      speak(response.text, response.lang);
    }, 300);
  }

  function handleFinalTranscript(text: string) {
    const cleanText = normalize(text);
    if (!cleanText) {
      setEngineState("ready");
      return;
    }

    setTranscript(cleanText);
    setMessages((current) => [...current.slice(-7), { role: "child", text: cleanText, lang: languageMode === "turkish" ? "tr" : "en" }]);
    addAssistantResponse(cleanText);
  }

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = languageMode === "turkish" ? "tr-TR" : "en-US";
    recognition.onstart = () => {
      setTranscript("");
      setEngineState("listening");
    };
    recognition.onend = () => {
      setEngineState((state) => (state === "listening" ? "ready" : state));
    };
    recognition.onerror = (event) => {
      setEngineState("ready");
      const text =
        event.error === "not-allowed"
          ? "Microphone permission is blocked. Please allow microphone access."
          : "I could not hear that clearly. Please try again.";
      setMessages((current) => [...current.slice(-7), { role: "assistant", text, lang: "en" }]);
      speak(text);
    };
    recognition.onresult = (event) => {
      let text = "";
      for (let index = 0; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript;
      }

      setTranscript(normalize(text));
      const finalResult = event.results[event.results.length - 1];
      if (finalResult?.isFinal) {
        recognition.stop();
        handleFinalTranscript(text);
      }
    };
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setEngineState("ready");
  }

  function startSession() {
    const prompt = currentPrompt;
    setMessages((current) => [...current.slice(-7), { role: "assistant", text: prompt, lang: "en" }]);
    speak(prompt);
  }

  return (
    <main className="app-shell">
      <section className="conversation-panel" aria-label="Voice practice engine">
        <header className="session-header">
          <div>
            <p>English Mate</p>
            <h1>Voice practice engine</h1>
          </div>
          <span className={`engine-pill ${engineState}`}>{engineState}</span>
        </header>

        <div className="prompt-box">
          <span>Current prompt</span>
          <strong>{currentPrompt}</strong>
        </div>

        <div className="voice-controls">
          <button
            className="primary-talk"
            type="button"
            onClick={engineState === "listening" ? stopListening : startListening}
          >
            <span className="mic-icon" aria-hidden="true" />
            {engineState === "listening" ? "Stop listening" : "Start listening"}
          </button>
          <div className="control-row" aria-label="Recognition language">
            <button
              type="button"
              className={languageMode === "english" ? "selected" : ""}
              onClick={() => setLanguageMode("english")}
            >
              Listen in English
            </button>
            <button
              type="button"
              className={languageMode === "turkish" ? "selected" : ""}
              onClick={() => setLanguageMode("turkish")}
            >
              Listen in Turkish
            </button>
          </div>
        </div>

        <div className="live-text">
          <div>
            <span>Heard from child</span>
            <p>{transcript || "No speech captured yet."}</p>
          </div>
          <div>
            <span>Assistant response</span>
            <p>{assistantReply?.text}</p>
          </div>
        </div>

        <div className="secondary-actions">
          <button type="button" onClick={startSession}>
            Read prompt
          </button>
          <button
            type="button"
            onClick={() => assistantReply && speak(assistantReply.text, assistantReply.lang)}
          >
            Replay response
          </button>
        </div>

        {!speechSupported && (
          <p className="browser-note">
            This browser does not expose speech recognition. Use Chrome or Safari
            for the microphone prototype.
          </p>
        )}
      </section>

      <aside className="parent-panel" aria-label="Parent panel">
        <header>
          <p>Parent panel</p>
          <h2>Session settings</h2>
        </header>

        <label className="field">
          <span>Child label</span>
          <input
            value={settings.childName}
            onChange={(event) => updateSettings({ childName: event.target.value })}
          />
        </label>

        <div className="field">
          <span>Level</span>
          <div className="segmented">
            {(Object.keys(levelLabels) as Level[]).map((level) => (
              <button
                key={level}
                type="button"
                className={settings.level === level ? "selected" : ""}
                onClick={() => updateSettings({ level })}
              >
                {levelLabels[level]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Topic</span>
          <select
            value={settings.topic}
            onChange={(event) => updateSettings({ topic: event.target.value as Topic })}
          >
            {(Object.keys(topicLabels) as Topic[]).map((topic) => (
              <option key={topic} value={topic}>
                {topicLabels[topic]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <span>Correction style</span>
          <div className="segmented">
            {(Object.keys(correctionLabels) as CorrectionStyle[]).map((style) => (
              <button
                key={style}
                type="button"
                className={settings.correctionStyle === style ? "selected" : ""}
                onClick={() => updateSettings({ correctionStyle: style })}
              >
                {correctionLabels[style]}
              </button>
            ))}
          </div>
        </div>

        <label className="switch-row">
          <input
            type="checkbox"
            checked={settings.turkishBridge}
            onChange={(event) => updateSettings({ turkishBridge: event.target.checked })}
          />
          <span />
          Turkish bridge
        </label>

        <div className="engine-plan">
          <h3>Next engine layer</h3>
          <ol>
            <li>Browser captures child speech.</li>
            <li>Backend transcribes and detects Turkish help.</li>
            <li>AI coach returns one short spoken correction.</li>
            <li>Phone and physical toy use the same endpoint.</li>
          </ol>
        </div>
      </aside>

      <section className="history-panel" aria-label="Conversation history">
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={message.role}>
            <span>{message.role === "child" ? settings.childName || "Child" : "Assistant"}</span>
            <p>{message.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
