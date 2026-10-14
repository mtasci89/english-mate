import { useCallback, useEffect, useRef, useState } from "react";

import { speak } from "../audio/player";
import { audioKeys, lines, topicIntroText } from "../curriculum";
import { logBlock } from "../telemetry";
import type { BlockKind, DayPlan, Topic } from "../session/programme";
import { ChatScreen } from "./ChatScreen";
import { GameScreen } from "./GameScreen";
import { StoryBlock } from "./StoryBlock";
import type { Settings } from "../types";

type Props = {
  plan: DayPlan;
  topic: Topic;
  settings: Settings;
  onExit: () => void;
};

const blockLabels: Record<BlockKind, string> = {
  warmup: "Move",
  talk: "Talk",
  story: "Story",
};

const blockGame = { warmup: "move", talk: "chat", story: "story" } as const;

/**
 * The evening, start to finish.
 *
 * Nothing here is chosen by the child: the topic is tonight's, the blocks run
 * in order, and the toy announces each one. That is the whole redesign — a
 * ritual the child is called into, rather than an app they have to want to
 * open.
 *
 * Every block logs when it started and whether it finished, because the only
 * honest way to set block lengths is to watch where this particular child
 * leaves.
 */
export function SessionScreen({ plan, topic, settings, onExit }: Props) {
  const [index, setIndex] = useState(0);
  const [announcing, setAnnouncing] = useState(true);
  const startedAtRef = useRef(Date.now());
  const activeRef = useRef(true);

  const block = plan.blocks[index];
  const done = index >= plan.blocks.length;

  useEffect(() => {
    activeRef.current = true;
    logBlock("session", topic.key, "started");
    return () => {
      activeRef.current = false;
    };
  }, [topic.key]);

  /** Spoken hand-over, so the child always knows what is about to happen. */
  const announce = useCallback(async () => {
    setAnnouncing(true);

    if (index === 0) {
      await speak({ text: lines.sessionHello.text, lang: "en", audioKey: lines.sessionHello.key });
      await speak({
        text: topicIntroText(topic.en),
        lang: "en",
        audioKey: audioKeys.topicIntro(topic.key),
      });
    } else {
      const lead = plan.blocks[index].kind === "story" ? lines.toStory : lines.toTalk;
      await speak({ text: lead.text, lang: "en", audioKey: lead.key });
    }

    if (activeRef.current) setAnnouncing(false);
  }, [index, plan.blocks, topic]);

  useEffect(() => {
    if (done) return;
    void announce();
  }, [done, announce]);

  useEffect(() => {
    if (!done) return;
    logBlock("session", topic.key, "completed", Math.round((Date.now() - startedAtRef.current) / 1000));
    void speak({ text: lines.sessionEnd.text, lang: "en", audioKey: lines.sessionEnd.key });
  }, [done, topic.key]);

  const startBlockAt = useRef(Date.now());

  useEffect(() => {
    if (done || announcing) return;
    startBlockAt.current = Date.now();
    logBlock(blockGame[plan.blocks[index].kind], plan.blocks[index].kind, "started");
  }, [index, announcing, done, plan.blocks]);

  function finishBlock() {
    const kind = plan.blocks[index].kind;
    logBlock(
      blockGame[kind],
      kind,
      "completed",
      Math.round((Date.now() - startBlockAt.current) / 1000),
    );
    setIndex((value) => value + 1);
  }

  function leaveEarly() {
    if (!done) {
      const kind = plan.blocks[index]?.kind;
      if (kind) {
        logBlock(
          blockGame[kind],
          kind,
          "abandoned",
          Math.round((Date.now() - startBlockAt.current) / 1000),
        );
      }
      logBlock("session", topic.key, "abandoned");
    }
    onExit();
  }

  if (done) {
    return (
      <section className="session-screen" aria-label="Session finished">
        <div className="round-done">
          <span className="game-visual" aria-hidden="true">
            🌙
          </span>
          <p>Good night!</p>
          <button type="button" className="primary-talk" onClick={onExit}>
            Finish
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="session-screen" aria-label="Evening session">
      <header className="session-bar">
        <button type="button" className="ghost-button" onClick={leaveEarly}>
          ← Stop
        </button>
        <ol className="block-track">
          {plan.blocks.map((item, position) => (
            <li
              key={item.kind}
              className={position === index ? "current" : position < index ? "past" : ""}
            >
              {blockLabels[item.kind]}
            </li>
          ))}
        </ol>
        <span className="round-counter">{topic.en}</span>
      </header>

      {announcing ? (
        <div className="game-stage">
          <span className="game-visual" aria-hidden="true">
            ✨
          </span>
          <p className="game-prompt">{topic.en}</p>
        </div>
      ) : block.kind === "story" ? (
        <StoryBlock topic={topic.key} minutes={block.minutes} onDone={finishBlock} />
      ) : block.kind === "talk" ? (
        <ChatScreen
          settings={settings}
          topic={topic}
          minutes={block.minutes}
          onDone={finishBlock}
          onExit={leaveEarly}
          embedded
        />
      ) : (
        <GameScreen
          gameId="move"
          minutes={block.minutes}
          topicWords={topic.words}
          onDone={finishBlock}
          onExit={leaveEarly}
        />
      )}
    </section>
  );
}
