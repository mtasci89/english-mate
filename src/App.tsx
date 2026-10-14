import { useEffect, useMemo, useState } from "react";

import { loadManifest, loadVoices } from "./audio/player";
import { ParentPanel } from "./components/ParentPanel";
import { SessionScreen } from "./components/SessionScreen";
import { TonightScreen } from "./components/TonightScreen";
import { readProgramme, tonight, writeProgramme, type Programme } from "./session/programme";
import { readSettings, writeSettings } from "./settings";
import type { Settings } from "./types";

type Screen = "tonight" | "session" | "parent";

/**
 * One evening, one programme.
 *
 * There is no menu. The child is not asked which game they fancy — the earlier
 * shape made a six-year-old stand in front of a screen and decide, which is the
 * opposite of a toy. Tonight's topic and blocks come from the weekly programme
 * the parent set, and the session runs them in order.
 */
export function App() {
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [programme, setProgramme] = useState<Programme>(() => readProgramme());
  const [screen, setScreen] = useState<Screen>("tonight");

  // Both pulled in early: the manifest so the first prompt plays from cache,
  // the voice list because the browser fills it asynchronously.
  useEffect(() => {
    void loadManifest();
    void loadVoices();
  }, []);

  const { plan, topic } = useMemo(() => tonight(programme), [programme]);

  function updateSettings(next: Partial<Settings>) {
    setSettings((current) => {
      const updated = { ...current, ...next };
      writeSettings(updated);
      return updated;
    });
  }

  function updateProgramme(next: Programme) {
    setProgramme(next);
    writeProgramme(next);
  }

  return (
    <main className="app-shell">
      {screen === "tonight" && (
        <TonightScreen
          plan={plan}
          topic={topic}
          startAt={programme.startAt}
          onStart={() => setScreen("session")}
          onOpenParent={() => setScreen("parent")}
        />
      )}

      {screen === "session" && (
        <SessionScreen
          plan={plan}
          topic={topic}
          settings={settings}
          onExit={() => setScreen("tonight")}
        />
      )}

      {screen === "parent" && (
        <ParentPanel
          settings={settings}
          onChange={updateSettings}
          programme={programme}
          onProgrammeChange={updateProgramme}
          onExit={() => setScreen("tonight")}
        />
      )}
    </main>
  );
}
