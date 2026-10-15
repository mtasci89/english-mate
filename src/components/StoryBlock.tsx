import { useCallback, useEffect, useRef, useState } from "react";

import { preloadNarration, playSlice, stopNarration } from "../audio/narration";
import { cancelSpeech, speak } from "../audio/player";
import { lines } from "../curriculum";
import {
  NARRATION_RATE,
  storyAudioKeys,
  storySeconds,
  storiesByTopic,
  type Story,
  type StoryQuestion,
} from "../curriculum/stories";
import { matchAnswer } from "../speech/match";
import { createRecognizer, type Recognizer } from "../speech/recognition";
import { logAttempt, sessionId } from "../telemetry";
import type { EngineState, Speakable } from "../types";

type Props = {
  topic: string;
  minutes: number;
  onDone: () => void;
};

/**
 * The listening block.
 *
 * The child does not have to perform here. Lines play one after another — a
 * human narrator's page for a fetched book, cached TTS for a hand-written one — and every so often the story stops for one easy question — just
 * enough to know they are still with it. A missed question costs nothing: the
 * story carries on either way, because stopping a story to drill a child is how
 * you teach them to dread stories.
 */
export function StoryBlock({ topic, minutes, onDone }: Props) {
  const [story, setStory] = useState<Story | null>(null);
  const [lineIndex, setLineIndex] = useState(0);
  const [question, setQuestion] = useState<StoryQuestion | null>(null);
  const [engineState, setEngineState] = useState<EngineState>("speaking");
  const [transcript, setTranscript] = useState("");
  const [trHelp, setTrHelp] = useState<string | null>(null);

  const activeRef = useRef(true);
  const recognizerRef = useRef<Recognizer | null>(null);
  const answeredRef = useRef(false);

  // Fits as many whole stories into the block as its minutes allow, rather than
  // cutting one off part-way: an unfinished story is worse than a short block.
  const playlistRef = useRef<Story[]>([]);
  const playlistIndexRef = useRef(0);

  useEffect(() => {
    const available = storiesByTopic(topic);
    const budget = minutes * 60;
    const chosen: Story[] = [];
    let used = 0;

    for (const candidate of available) {
      const cost = storySeconds(candidate);
      if (used + cost > budget && chosen.length) break;
      chosen.push(candidate);
      used += cost;
    }

    playlistRef.current = chosen.length ? chosen : available.slice(0, 1);
    playlistIndexRef.current = 0;
    setStory(playlistRef.current[0] ?? null);
    setLineIndex(0);
  }, [topic, minutes]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      cancelSpeech();
      stopNarration();
      recognizerRef.current?.cancel();
    };
  }, []);

  const say = useCallback(async (speakable: Speakable) => {
    setEngineState("speaking");
    await speak(speakable);
  }, []);

  const askQuestion = useCallback(
    async (current: Story, pending: StoryQuestion) => {
      answeredRef.current = false;
      setQuestion(pending);
      setTrHelp(null);
      setTranscript("");

      await say({
        text: pending.text,
        lang: "en",
        audioKey: storyAudioKeys.question(current.key, pending.id),
      });

      if (activeRef.current) setEngineState("ready");
    },
    [say],
  );

  /** Plays the next line, or asks the question that follows it. */
  const advance = useCallback(async () => {
    const current = story;
    if (!current) return;

    if (lineIndex >= current.lines.length) {
      await say({ text: lines.storyDone.text, lang: "en", audioKey: lines.storyDone.key });

      const next = playlistIndexRef.current + 1;
      if (next < playlistRef.current.length && activeRef.current) {
        playlistIndexRef.current = next;
        setStory(playlistRef.current[next]);
        setLineIndex(0);
        return;
      }

      onDone();
      return;
    }

    const line = current.lines[lineIndex];
    let played = false;
    if (current.audio && typeof line.start === "number") {
      setEngineState("speaking");
      played = await playSlice(current.audio, line.start, line.end ?? line.start + 10, NARRATION_RATE);
    }
    // No narration, or it would not load: a synthetic voice is worse than the
    // narrator but far better than the story stopping.
    if (!played && activeRef.current) {
      await say({
        text: line.text,
        lang: "en",
        audioKey: current.audio ? undefined : storyAudioKeys.line(current.key, line.id),
      });
    }
    if (!activeRef.current) return;

    const pending = current.questions.find((item) => item.after === line.id);
    if (pending) {
      await askQuestion(current, pending);
      return;
    }

    setLineIndex((index) => index + 1);
  }, [story, lineIndex, say, askQuestion, onDone]);

  useEffect(() => {
    if (story?.audio) preloadNarration(story.audio);
  }, [story]);

  // Lines play on their own; only a question waits for the child.
  useEffect(() => {
    if (!story || question) return;
    void advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, lineIndex, question]);

  function finishQuestion(current: StoryQuestion, heard: string) {
    if (answeredRef.current) return;
    answeredRef.current = true;

    const result = matchAnswer(heard, current.target, current.distractors);

    logAttempt({
      ts: Date.now(),
      sessionId: sessionId(),
      game: "story",
      itemKey: `${story?.key ?? "story"}-${current.id}`,
      target: current.target,
      heard: heard || null,
      accepted: result.accepted,
      score: result.silent ? null : result.score,
      trLifeline: Boolean(trHelp),
      hintLevel: 0,
      latencyMs: null,
    });

    void (async () => {
      // Praise a hit, wave a miss along. The story is not a test.
      const reply = result.accepted ? lines.praise[0] : lines.moveOn[0];
      await say({ text: reply.text, lang: "en", audioKey: reply.key });
      if (!activeRef.current) return;
      setQuestion(null);
      setTrHelp(null);
      setLineIndex((index) => index + 1);
    })();
  }

  function startListening() {
    if (!question || engineState === "listening") return;

    cancelSpeech();
    setTranscript("");
    setEngineState("listening");

    const recognizer =
      recognizerRef.current ??
      createRecognizer({
        lang: "en-US",
        onPartial: setTranscript,
        onFinal: (text) => {
          if (activeRef.current && question) finishQuestion(question, text);
        },
        onDenied: () => setEngineState("ready"),
      });

    recognizerRef.current = recognizer;
    recognizer.start();
  }

  const spoken = story?.lines[Math.min(lineIndex, story.lines.length - 1)];

  return (
    <section className="story-block" aria-label="Story">
      <div className="story-stage">
        <span className="story-title">{story?.title}</span>
        {spoken?.image && <img className="story-image" src={spoken.image} alt="" />}
        <p className={`story-line ${!question && (spoken?.text.length ?? 0) > 70 ? "long" : ""}`}>
          {question ? question.text : spoken?.text}
        </p>
      </div>

      {question ? (
        <>
          <button
            type="button"
            className={`primary-talk talk-button ${engineState === "listening" ? "active" : ""}`}
            disabled={engineState === "speaking"}
            onPointerDown={startListening}
            onPointerUp={() => recognizerRef.current?.stop()}
            onPointerCancel={() => recognizerRef.current?.stop()}
          >
            <span className="mic-icon" aria-hidden="true" />
            {engineState === "listening" ? "Keep talking…" : "Hold and answer"}
          </button>

          {trHelp && <p className="lifeline-text">{trHelp}</p>}
          <p className="heard-line">{transcript || " "}</p>

          <div className="helper-row">
            <button
              type="button"
              className="lifeline-button"
              onClick={() => setTrHelp(question.trHelp)}
            >
              Anlamadım
            </button>
          </div>
        </>
      ) : (
        <p className="story-hint">Dinle…</p>
      )}
    </section>
  );
}
