import { useEffect, useState } from "react";

import { loadVoices, turkishVoiceAvailable } from "../audio/player";
import { wordKeys } from "../curriculum";
import { listGaps } from "../curriculum/gaps";
import { progressSummary } from "../curriculum/srs";
import { correctionLabels, levelLabels, topicLabels } from "../settings";
import { blockCompletion, fetchAttempts, fetchSummary, type Summary } from "../telemetry";
import {
  defaultBlocks,
  topics,
  weekdayNames,
  type BlockKind,
  type Programme,
} from "../session/programme";
import type { CorrectionStyle, Level, Settings, Topic } from "../types";

type Props = {
  settings: Settings;
  onChange: (next: Partial<Settings>) => void;
  programme: Programme;
  onProgrammeChange: (next: Programme) => void;
  onExit: () => void;
};

const blockLabels: Record<BlockKind, string> = {
  warmup: "Hareket",
  talk: "Sohbet",
  story: "Hikâye",
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function ParentPanel({
  settings,
  onChange,
  programme,
  onProgrammeChange,
  onExit,
}: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [blocks, setBlocks] = useState<ReturnType<typeof blockCompletion>>([]);
  const [turkishVoice, setTurkishVoice] = useState(true);
  const vocabulary = progressSummary(wordKeys);
  const gaps = listGaps();

  useEffect(() => {
    let cancelled = false;
    void fetchSummary(7).then((result) => {
      if (!cancelled) setSummary(result);
    });
    void fetchAttempts(14).then((rows) => {
      if (!cancelled) setBlocks(blockCompletion(rows));
    });
    void loadVoices().then(() => {
      if (!cancelled) setTurkishVoice(turkishVoiceAvailable());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="parent-panel" aria-label="Parent panel">
      <header>
        <div>
          <p>Parent panel</p>
          <h2>Progress and settings</h2>
        </div>
        <button type="button" className="ghost-button" onClick={onExit}>
          Done
        </button>
      </header>

      {/*
        The numbers come first. These are the figures the phase-zero decision
        rests on: whether the child keeps coming back, whether answers are being
        recognised at all, and whether the Turkish lifeline is fading over time.
      */}
      <div className="stat-grid">
        <div className="stat">
          <span>Rounds this week</span>
          <strong>{summary ? summary.sessions : "—"}</strong>
        </div>
        <div className="stat">
          <span>Answers heard</span>
          <strong>{summary ? summary.attempts : "—"}</strong>
        </div>
        <div className="stat">
          <span>Accepted</span>
          <strong>{summary ? percent(summary.acceptRate) : "—"}</strong>
        </div>
        <div className="stat">
          <span>Turkish help used</span>
          <strong>{summary ? percent(summary.lifelineRate) : "—"}</strong>
        </div>
        <div className="stat">
          <span>Words started</span>
          <strong>
            {vocabulary.started} / {vocabulary.total}
          </strong>
        </div>
        <div className="stat">
          <span>Words sticking</span>
          <strong>{vocabulary.known}</strong>
        </div>
      </div>

      {!turkishVoice && (
        <p className="browser-note">
          This device has no Turkish voice installed, so the Turkish lifeline is
          read with an English voice. It is still shown on screen. Adding a
          Turkish system voice in the device's speech settings fixes the
          pronunciation.
        </p>
      )}

      {summary?.source === "local" && (
        <p className="browser-note">
          Showing this device only — the attempts function is not reachable, so
          server history is unavailable.
        </p>
      )}

      {/*
        Words the child reached for in Turkish during a conversation. This is
        the most direct evidence of what they want to say and cannot yet, and
        Name It deals these back in until they are produced unaided.
      */}
      {gaps.length > 0 && (
        <div className="engine-plan">
          <h3>Words he reached for</h3>
          <p>
            Picked up mid-conversation and now mixed into Name It. Each one drops
            off the list once he says it in English on his own.
          </p>
          <ul className="gap-list">
            {gaps
              .slice()
              .reverse()
              .map((gap) => (
                <li key={gap.en}>
                  <strong>{gap.en}</strong> <span>{gap.tr}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {/*
        Block completion is the number the session lengths are set from. Twenty
        minutes of talking is a guess; where this child actually leaves is a
        fact, and the minutes below should follow it.
      */}
      {blocks.length > 0 && (
        <div className="engine-plan">
          <h3>Blokları bitirme</h3>
          <ul className="gap-list">
            {blocks.map((block) => (
              <li key={block.key}>
                <strong>{blockLabels[block.key as BlockKind] ?? block.key}</strong>{" "}
                <span>
                  {block.completed}/{block.runs} · {Math.round(block.rate * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field">
        <span>Akşam saati</span>
        <input
          type="time"
          value={programme.startAt}
          onChange={(event) =>
            onProgrammeChange({ ...programme, startAt: event.target.value })
          }
        />
      </div>

      <div className="field">
        <span>Haftalık program</span>
        <div className="week-grid">
          {programme.days.map((day, index) => (
            <label key={weekdayNames[index]} className="week-row">
              <span>{weekdayNames[index]}</span>
              <select
                value={day.topic}
                onChange={(event) => {
                  const days = programme.days.map((item, position) =>
                    position === index ? { ...item, topic: event.target.value } : item,
                  );
                  onProgrammeChange({ ...programme, days });
                }}
              >
                {topics.map((topic) => (
                  <option key={topic.key} value={topic.key}>
                    {topic.tr}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Blok süreleri (dakika)</span>
        <div className="week-grid">
          {defaultBlocks.map((block) => {
            const current =
              programme.days[0].blocks.find((item) => item.kind === block.kind) ?? block;
            return (
              <label key={block.kind} className="week-row">
                <span>{blockLabels[block.kind]}</span>
                <input
                  type="number"
                  min={1}
                  max={45}
                  value={current.minutes}
                  onChange={(event) => {
                    const minutes = Number(event.target.value) || 1;
                    // One set of lengths across the week: a child's stamina does
                    // not change by weekday, and seven editors is seven chances
                    // to get it wrong.
                    const days = programme.days.map((day) => ({
                      ...day,
                      blocks: day.blocks.map((item) =>
                        item.kind === block.kind ? { ...item, minutes } : item,
                      ),
                    }));
                    onProgrammeChange({ ...programme, days });
                  }}
                />
              </label>
            );
          })}
        </div>
      </div>

      <label className="field">
        <span>Child label</span>
        <input value={settings.childName} onChange={(event) => onChange({ childName: event.target.value })} />
      </label>

      <div className="field">
        <span>Level</span>
        <div className="segmented">
          {(Object.keys(levelLabels) as Level[]).map((level) => (
            <button
              key={level}
              type="button"
              className={settings.level === level ? "selected" : ""}
              onClick={() => onChange({ level })}
            >
              {levelLabels[level]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Chat topic</span>
        <select value={settings.topic} onChange={(event) => onChange({ topic: event.target.value as Topic })}>
          {(Object.keys(topicLabels) as Topic[]).map((topic) => (
            <option key={topic} value={topic}>
              {topicLabels[topic]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span>Coaching style</span>
        <div className="segmented">
          {(Object.keys(correctionLabels) as CorrectionStyle[]).map((style) => (
            <button
              key={style}
              type="button"
              className={settings.correctionStyle === style ? "selected" : ""}
              onClick={() => onChange({ correctionStyle: style })}
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
          onChange={(event) => onChange({ turkishBridge: event.target.checked })}
        />
        <span />
        Turkish lifeline
      </label>

      <div className="engine-plan">
        <h3>How Turkish is used</h3>
        <p>
          Turkish never starts a turn and never ends one. It appears only when the
          child presses <strong>Anlamadım</strong>, and the English phrase is always
          repeated straight after, with the answer still owed in English. Watch the
          "Turkish help used" figure fall over the weeks — if it does not, the level
          is too hard.
        </p>
      </div>
    </section>
  );
}
