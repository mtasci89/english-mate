import { useEffect, useState } from "react";

import { wordKeys } from "../curriculum";
import { progressSummary } from "../curriculum/srs";
import { correctionLabels, levelLabels, topicLabels } from "../settings";
import { fetchSummary, type Summary } from "../telemetry";
import type { CorrectionStyle, Level, Settings, Topic } from "../types";

type Props = {
  settings: Settings;
  onChange: (next: Partial<Settings>) => void;
  onExit: () => void;
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function ParentPanel({ settings, onChange, onExit }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const vocabulary = progressSummary(wordKeys);

  useEffect(() => {
    let cancelled = false;
    void fetchSummary(7).then((result) => {
      if (!cancelled) setSummary(result);
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

      {summary?.source === "local" && (
        <p className="browser-note">
          Showing this device only — the attempts function is not reachable, so
          server history is unavailable.
        </p>
      )}

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
