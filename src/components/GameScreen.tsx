import { useCallback, useEffect, useRef, useState } from "react";

import { cancelSpeech, loadManifest, preload, speak } from "../audio/player";
import { clearGap } from "../curriculum/gaps";
import { recordResult } from "../curriculum/srs";
import {
  feedbackForAction,
  feedbackForSpeech,
  introFor,
  lifelineFor,
  nextMoveTurn,
  nextNameTurn,
  sessionEndLine,
} from "../games/turns";
import { createRecognizer, speechRecognitionSupported, type Recognizer } from "../speech/recognition";
import { matchAnswer } from "../speech/match";
import { logAttempt, sessionId } from "../telemetry";
import type { EngineState, GameId, Speakable, Turn } from "../types";

/** A round is short on purpose: attention, not coverage, is the scarce resource. */
const TURNS_PER_ROUND = 8;

type Props = {
  gameId: Extract<GameId, "move" | "nameit">;
  onExit: () => void;
};

const stateLabels: Record<EngineState, string> = {
  ready: "your turn",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
};

export function GameScreen({ gameId, onExit }: Props) {
  const [turn, setTurn] = useState<Turn | null>(null);
  const [engineState, setEngineState] = useState<EngineState>("speaking");
  const [transcript, setTranscript] = useState("");
  const [completed, setCompleted] = useState(0);
  const [micDenied, setMicDenied] = useState(false);
  const [finished, setFinished] = useState(false);
  // Shown as well as spoken: a device with no Turkish voice would otherwise
  // give the child nothing at all, and a parent nearby can read it out.
  const [lifelineText, setLifelineText] = useState<string | null>(null);

  // Async speech callbacks outlive the render that created them, so the live
  // turn context is held in refs rather than read from a stale closure.
  const turnRef = useRef<Turn | null>(null);
  const hintLevelRef = useRef(0);
  const lifelineRef = useRef(false);
  const releasedAtRef = useRef<number | null>(null);
  const previousKeyRef = useRef<string | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const activeRef = useRef(true);

  const speakAll = useCallback(async (speakables: Speakable[]) => {
    setEngineState("speaking");
    for (const speakable of speakables) {
      if (!activeRef.current) return;
      await speak(speakable);
    }
    if (activeRef.current) setEngineState("ready");
  }, []);

  const startTurn = useCallback(async () => {
    const next = gameId === "move" ? nextMoveTurn(previousKeyRef.current) : nextNameTurn(previousKeyRef.current);
    previousKeyRef.current = next.itemKey;
    turnRef.current = next;
    hintLevelRef.current = 0;
    lifelineRef.current = false;

    setTurn(next);
    setTranscript("");
    setLifelineText(null);
    preload([next.prompt, next.englishRepeat]);
    await speakAll([next.prompt]);
  }, [gameId, speakAll]);

  useEffect(() => {
    activeRef.current = true;

    void (async () => {
      await loadManifest();
      if (!activeRef.current) return;
      await speakAll([introFor(gameId)]);
      if (!activeRef.current) return;
      await startTurn();
    })();

    return () => {
      activeRef.current = false;
      cancelSpeech();
      recognizerRef.current?.cancel();
    };
  }, [gameId, speakAll, startTurn]);

  const finishItem = useCallback(
    async (feedback: ReturnType<typeof feedbackForAction>) => {
      hintLevelRef.current = feedback.nextHintLevel;
      await speakAll(feedback.speakables);
      if (!activeRef.current) return;

      if (!feedback.advance) return;

      const nextCount = completed + 1;
      setCompleted(nextCount);

      if (nextCount >= TURNS_PER_ROUND) {
        setFinished(true);
        await speakAll([sessionEndLine()]);
        return;
      }

      await startTurn();
    },
    [completed, speakAll, startTurn],
  );

  const handleAnswer = useCallback(
    async (heard: string) => {
      const current = turnRef.current;
      if (!current || current.expects !== "speech" || !current.target) return;

      setEngineState("thinking");
      setTranscript(heard);

      const result = matchAnswer(heard, current.target, current.distractors);
      const feedback = feedbackForSpeech(result, hintLevelRef.current, current);

      if (!result.silent) recordResult(current.itemKey, result.accepted);
      // A captured gap is closed once the child produces it unaided; leaving it
      // in the deck would spend turns on a word they now have.
      if (result.accepted && current.target && current.visualText) clearGap(current.target);

      logAttempt({
        ts: Date.now(),
        sessionId: sessionId(),
        game: current.gameId,
        itemKey: current.itemKey,
        target: current.target,
        heard: heard || null,
        accepted: result.accepted,
        score: result.silent ? null : result.score,
        trLifeline: lifelineRef.current,
        hintLevel: hintLevelRef.current,
        latencyMs: releasedAtRef.current ? Date.now() - releasedAtRef.current : null,
      });

      await finishItem(feedback);
    },
    [finishItem],
  );

  /*
   * The recogniser is built once and armed as soon as the turn is the child's,
   * not on the press. Spinning it up takes the browser a few hundred
   * milliseconds, and a child who pressed and spoke at once lost the first word
   * and had to say it again.
   */
  const handleAnswerRef = useRef(handleAnswer);
  handleAnswerRef.current = handleAnswer;

  useEffect(() => {
    const recognizer = createRecognizer({
      lang: "en-US",
      onPartial: setTranscript,
      onFinal: (text) => {
        if (activeRef.current) void handleAnswerRef.current(text);
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
    if (engineState === "ready" && !finished && !micDenied && turn?.expects === "speech") {
      recognizerRef.current?.arm();
    }
  }, [engineState, finished, micDenied, turn]);

  function startListening() {
    if (engineState === "listening" || finished) return;

    cancelSpeech();
    setTranscript("");
    setEngineState("listening");
    recognizerRef.current?.start();
  }

  function stopListening() {
    releasedAtRef.current = Date.now();
    recognizerRef.current?.stop();
  }

  function handleActionDone() {
    const current = turnRef.current;
    if (!current || finished) return;

    recordResult(current.itemKey, true);
    logAttempt({
      ts: Date.now(),
      sessionId: sessionId(),
      game: current.gameId,
      itemKey: current.itemKey,
      target: null,
      heard: null,
      accepted: true,
      score: null,
      trLifeline: lifelineRef.current,
      hintLevel: hintLevelRef.current,
      latencyMs: null,
    });

    void finishItem(feedbackForAction());
  }

  async function useLifeline() {
    const current = turnRef.current;
    if (!current) return;

    lifelineRef.current = true;
    recognizerRef.current?.cancel();
    setLifelineText(current.trHelp);
    await speakAll(lifelineFor(current));
  }

  function replayPrompt() {
    const current = turnRef.current;
    if (current) void speakAll([current.prompt]);
  }

  const busy = engineState === "speaking" || engineState === "thinking";

  return (
    <section className="game-screen" aria-label={gameId === "move" ? "Move with me" : "Name it"}>
      <header className="game-header">
        <button type="button" className="ghost-button" onClick={onExit}>
          ← Back
        </button>
        <span className={`engine-pill ${engineState}`}>{stateLabels[engineState]}</span>
        <span className="round-counter" aria-label="Progress in this round">
          {Math.min(completed + 1, TURNS_PER_ROUND)} / {TURNS_PER_ROUND}
        </span>
      </header>

      {finished ? (
        <div className="round-done">
          <span className="game-visual" aria-hidden="true">
            🎉
          </span>
          <p>Great round!</p>
          <button type="button" className="primary-talk" onClick={onExit}>
            Finish
          </button>
        </div>
      ) : (
        <>
          <div className="game-stage">
            {turn?.visualColor ? (
              <span
                className="game-swatch"
                style={{ background: turn.visualColor }}
                aria-hidden="true"
              />
            ) : turn?.visual ? (
              <span className="game-visual" aria-hidden="true">
                {turn.visual}
              </span>
            ) : (
              <span className="game-word" lang="tr">
                {turn?.visualText}
              </span>
            )}
            <p className="game-prompt">{turn?.prompt.text}</p>
          </div>

          {turn?.expects === "action" ? (
            <button
              type="button"
              className="primary-talk action-button"
              onClick={handleActionDone}
              disabled={busy}
            >
              I did it!
            </button>
          ) : (
            <button
              type="button"
              className={`primary-talk talk-button ${engineState === "listening" ? "active" : ""}`}
              disabled={busy || micDenied}
              onPointerDown={startListening}
              onPointerUp={stopListening}
              onPointerCancel={stopListening}
              onPointerLeave={() => engineState === "listening" && stopListening()}
            >
              <span className="mic-icon" aria-hidden="true" />
              {engineState === "listening" ? "Keep talking…" : "Hold and say it"}
            </button>
          )}

          {lifelineText && <p className="lifeline-text">{lifelineText}</p>}

          <p className="heard-line">{transcript || " "}</p>

          <div className="helper-row">
            <button type="button" className="ghost-button" onClick={replayPrompt} disabled={busy}>
              Say it again
            </button>
            <button type="button" className="lifeline-button" onClick={useLifeline} disabled={busy}>
              Anlamadım
            </button>
          </div>
        </>
      )}

      {micDenied && (
        <p className="browser-note">
          Microphone permission is blocked. Allow it in the browser settings, then reload.
        </p>
      )}
      {!speechRecognitionSupported() && gameId === "nameit" && (
        <p className="browser-note">
          This browser has no speech recognition. Use Chrome or Safari for the talking games.
        </p>
      )}
    </section>
  );
}
