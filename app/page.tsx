"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type Level = "mini" | "starter" | "brave";
type Scene = "animals" | "home" | "park";
type Mood = "idle" | "listening" | "thinking" | "speaking" | "celebrate";

type ChatLine = {
  by: "child" | "buddy";
  text: string;
  lang?: "en" | "tr";
};

type Quest = {
  title: string;
  prompt: string;
  pattern: string;
  words: string[];
  scene: Scene;
};

const quests: Quest[] = [
  {
    title: "Animal action",
    prompt: "Say what the animal is doing.",
    pattern: "The dog is running.",
    words: ["dog", "cat", "bird", "run", "jump"],
    scene: "animals",
  },
  {
    title: "Tiny choice",
    prompt: "Choose one and say a full sentence.",
    pattern: "I like the red car.",
    words: ["red", "blue", "car", "ball", "train"],
    scene: "home",
  },
  {
    title: "Feeling words",
    prompt: "Tell me how the friend feels.",
    pattern: "The boy is happy.",
    words: ["happy", "sleepy", "hungry", "sad", "excited"],
    scene: "park",
  },
  {
    title: "Make it bigger",
    prompt: "Start small, then add one more word.",
    pattern: "A small yellow duck is swimming.",
    words: ["small", "yellow", "duck", "swim", "fast"],
    scene: "animals",
  },
];

const sceneLabels: Record<Scene, string> = {
  animals: "Animals",
  home: "Home",
  park: "Park",
};

const levelCopy: Record<Level, { label: string; sentence: string; nudge: string }> = {
  mini: {
    label: "Mini",
    sentence: "Try two or three words.",
    nudge: "Great start. I will make it a little bigger.",
  },
  starter: {
    label: "Starter",
    sentence: "Try one full sentence.",
    nudge: "Nice sentence. Let's add one detail.",
  },
  brave: {
    label: "Brave",
    sentence: "Try two connected sentences.",
    nudge: "Strong idea. Now connect it with because.",
  },
};

const turkishHints = [
  "ne demek",
  "bilmiyorum",
  "yardim",
  "yardım",
  "nasıl",
  "türkçe",
  "soyle",
  "söyle",
  "anlamadım",
  "zor",
];

function looksTurkish(text: string) {
  const lower = text.toLocaleLowerCase("tr-TR");
  return /[çğıöşü]/i.test(text) || turkishHints.some((hint) => lower.includes(hint));
}

function normalize(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function readStoredSettings() {
  if (typeof window === "undefined") {
    return {} as { level?: Level; scene?: Scene; turkishBridge?: boolean };
  }

  const stored = window.localStorage.getItem("english-mate-settings");
  if (!stored) return {};

  try {
    return JSON.parse(stored) as {
      level?: Level;
      scene?: Scene;
      turkishBridge?: boolean;
    };
  } catch {
    window.localStorage.removeItem("english-mate-settings");
    return {};
  }
}

function buildBuddyReply(
  rawText: string,
  quest: Quest,
  level: Level,
  turkishBridge: boolean,
) {
  const text = normalize(rawText);
  const lower = text.toLowerCase();
  const usedWords = quest.words.filter((word) => lower.includes(word));
  const isTurkish = looksTurkish(text);

  if (isTurkish && turkishBridge) {
    return {
      text:
        "Takildigin yeri anladim. Simdi bunu Ingilizce soyleyelim: " +
        quest.pattern +
        " Benimle tekrar et.",
      lang: "tr" as const,
      success: true,
    };
  }

  if (!text) {
    return {
      text: "I am ready. Press the button and try: " + quest.pattern,
      lang: "en" as const,
      success: false,
    };
  }

  if (usedWords.length >= 2 || lower.split(" ").length >= 4) {
    const detail =
      level === "brave"
        ? " because it is fun."
        : level === "starter"
          ? " Add one color or feeling."
          : " Say it one more time.";
    return {
      text: `${levelCopy[level].nudge} You said: "${text}". Now try: ${quest.pattern}${detail}`,
      lang: "en" as const,
      success: true,
    };
  }

  return {
    text: `Good try. Let's make it a full English sentence: ${quest.pattern}`,
    lang: "en" as const,
    success: true,
  };
}

export default function Home() {
  const [level, setLevel] = useState<Level>(() => readStoredSettings().level ?? "starter");
  const [scene, setScene] = useState<Scene>(() => readStoredSettings().scene ?? "animals");
  const [questIndex, setQuestIndex] = useState(0);
  const [turkishBridge, setTurkishBridge] = useState(
    () => readStoredSettings().turkishBridge ?? true,
  );
  const [listenMode, setListenMode] = useState<"english" | "turkish">("english");
  const [mood, setMood] = useState<Mood>("idle");
  const [transcript, setTranscript] = useState("");
  const [lastReply, setLastReply] = useState("Hi! Press the big button and tell me about the picture.");
  const [chat, setChat] = useState<ChatLine[]>([
    {
      by: "buddy",
      text: "Hi! Press the big button and tell me about the picture.",
      lang: "en",
    },
  ]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const currentQuest = useMemo(() => {
    const sceneQuests = quests.filter((quest) => quest.scene === scene);
    return sceneQuests[questIndex % sceneQuests.length] ?? quests[0];
  }, [questIndex, scene]);

  useEffect(() => {
    window.localStorage.setItem(
      "english-mate-settings",
      JSON.stringify({ level, scene, turkishBridge }),
    );
  }, [level, scene, turkishBridge]);

  function speak(text: string, lang: "en" | "tr" = "en") {
    if (!("speechSynthesis" in window)) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "tr" ? "tr-TR" : "en-US";
    utterance.rate = lang === "tr" ? 0.92 : 0.84;
    utterance.pitch = 1.08;
    utterance.onstart = () => setMood("speaking");
    utterance.onend = () => setMood("idle");
    window.speechSynthesis.speak(utterance);
  }

  function addBuddyLine(text: string, lang: "en" | "tr" = "en") {
    setLastReply(text);
    setChat((lines) => [...lines.slice(-5), { by: "buddy", text, lang }]);
    speak(text, lang);
  }

  function handleTranscript(text: string) {
    const cleanText = normalize(text);
    if (!cleanText) return;

    setTranscript(cleanText);
    setChat((lines) => [...lines.slice(-5), { by: "child", text: cleanText }]);
    setMood("thinking");

    window.setTimeout(() => {
      const reply = buildBuddyReply(cleanText, currentQuest, level, turkishBridge);
      if (reply.success) {
        setMood("celebrate");
        window.setTimeout(() => setMood("speaking"), 450);
      }
      addBuddyLine(reply.text, reply.lang);
    }, 420);
  }

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      addBuddyLine("Speech recognition is not available in this browser yet. Try Chrome or Safari.");
      return;
    }

    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = listenMode === "turkish" ? "tr-TR" : "en-US";
    recognition.onstart = () => {
      setTranscript("");
      setMood("listening");
    };
    recognition.onerror = (event) => {
      setMood("idle");
      addBuddyLine(
        event.error === "not-allowed"
          ? "Microphone permission is closed. Please allow the microphone and try again."
          : "I could not hear that clearly. Let's try again.",
      );
    };
    recognition.onend = () => {
      if (mood === "listening") setMood("idle");
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
        handleTranscript(text);
      }
    };
    recognition.start();
  }

  function nextQuest() {
    const sceneQuests = quests.filter((quest) => quest.scene === scene);
    const nextIndex = (questIndex + 1) % sceneQuests.length;
    setQuestIndex(nextIndex);
    const next = sceneQuests[nextIndex];
    const prompt = next?.pattern ?? currentQuest.pattern;
    addBuddyLine("New quest! Try this: " + prompt);
  }

  return (
    <main className="toy-shell">
      <section className="hero-band">
        <div className="hero-copy">
          <p className="eyebrow">English Mate</p>
          <h1>Speak, play, repeat.</h1>
          <p>
            A mobile-first language toy for English practice, with Turkish help when
            a child gets stuck.
          </p>
        </div>

        <div className={`buddy-face ${mood}`} aria-label={`Buddy is ${mood}`}>
          <span className="ear left" />
          <span className="ear right" />
          <span className="eye left" />
          <span className="eye right" />
          <span className="cheek left" />
          <span className="cheek right" />
          <span className="mouth" />
        </div>
      </section>

      <section className="play-surface" aria-label="Language toy">
        <div className="quest-panel">
          <div>
            <p className="panel-label">Today&apos;s quest</p>
            <h2>{currentQuest.title}</h2>
            <p className="quest-prompt">{currentQuest.prompt}</p>
          </div>

          <div className="picture-stage" aria-label="Practice picture">
            <div className={`scene-art ${currentQuest.scene}`}>
              <span className="sun" />
              <span className="ground" />
              <span className="main-shape" />
              <span className="small-shape one" />
              <span className="small-shape two" />
            </div>
          </div>

          <div className="pattern-box">
            <span>Try saying</span>
            <strong>{currentQuest.pattern}</strong>
          </div>

          <div className="word-row" aria-label="Target words">
            {currentQuest.words.map((word) => (
              <button key={word} type="button" onClick={() => speak(word)}>
                {word}
              </button>
            ))}
          </div>
        </div>

        <div className="talk-panel">
          <div className="status-row">
            <span className={`status-dot ${mood}`} />
            <span>
              {mood === "listening"
                ? "Listening"
                : mood === "thinking"
                  ? "Thinking"
                  : mood === "speaking"
                    ? "Speaking"
                    : mood === "celebrate"
                      ? "Nice work"
                      : "Ready"}
            </span>
          </div>

          <button className="talk-button" type="button" onClick={startListening}>
            <span className="mic-mark" aria-hidden="true" />
            <span>{mood === "listening" ? "Listening..." : "Hold or tap to talk"}</span>
          </button>

          <div className="mode-row" aria-label="Listening language">
            <button
              type="button"
              className={listenMode === "english" ? "active" : ""}
              onClick={() => setListenMode("english")}
            >
              English
            </button>
            <button
              type="button"
              className={listenMode === "turkish" ? "active" : ""}
              onClick={() => setListenMode("turkish")}
            >
              Turkish help
            </button>
          </div>

          <div className="transcript-box">
            <span>Heard</span>
            <p>{transcript || "Nothing yet."}</p>
          </div>

          <div className="reply-box">
            <span>Buddy says</span>
            <p>{lastReply}</p>
          </div>

          <div className="action-row">
            <button type="button" onClick={() => speak(lastReply, looksTurkish(lastReply) ? "tr" : "en")}>
              Replay
            </button>
            <button type="button" onClick={nextQuest}>
              New quest
            </button>
          </div>

          {!speechSupported && (
            <p className="support-note">
              This browser does not expose speech recognition. The app still works
              as a clickable practice board.
            </p>
          )}
        </div>
      </section>

      <section className="parent-strip" aria-label="Parent controls">
        <div className="control-group">
          <span>Level</span>
          <div className="segmented">
            {(Object.keys(levelCopy) as Level[]).map((item) => (
              <button
                key={item}
                type="button"
                className={level === item ? "active" : ""}
                onClick={() => setLevel(item)}
              >
                {levelCopy[item].label}
              </button>
            ))}
          </div>
          <small>{levelCopy[level].sentence}</small>
        </div>

        <div className="control-group">
          <span>World</span>
          <div className="segmented">
            {(Object.keys(sceneLabels) as Scene[]).map((item) => (
              <button
                key={item}
                type="button"
                className={scene === item ? "active" : ""}
                onClick={() => {
                  setScene(item);
                  setQuestIndex(0);
                }}
              >
                {sceneLabels[item]}
              </button>
            ))}
          </div>
          <small>Target words change with the world.</small>
        </div>

        <label className="bridge-toggle">
          <input
            type="checkbox"
            checked={turkishBridge}
            onChange={(event) => setTurkishBridge(event.target.checked)}
          />
          <span />
          Turkish bridge
        </label>
      </section>

      <section className="history-log" aria-label="Short conversation history">
        {chat.slice(-4).map((line, index) => (
          <p key={`${line.by}-${index}`} className={line.by}>
            <span>{line.by === "child" ? "Child" : "Buddy"}</span>
            {line.text}
          </p>
        ))}
      </section>
    </main>
  );
}
