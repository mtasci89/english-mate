import { useEffect, useState } from "react";

import { loadManifest } from "./audio/player";
import { ChatScreen } from "./components/ChatScreen";
import { GameScreen } from "./components/GameScreen";
import { HomeScreen } from "./components/HomeScreen";
import { ParentPanel } from "./components/ParentPanel";
import { readSettings, writeSettings } from "./settings";
import type { GameId, Settings } from "./types";

type Screen = { name: "home" } | { name: "game"; gameId: GameId } | { name: "parent" };

export function App() {
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [screen, setScreen] = useState<Screen>({ name: "home" });

  // Pulled in early so the first prompt of the first game plays from cache.
  useEffect(() => {
    void loadManifest();
  }, []);

  function updateSettings(next: Partial<Settings>) {
    setSettings((current) => {
      const updated = { ...current, ...next };
      writeSettings(updated);
      return updated;
    });
  }

  const goHome = () => setScreen({ name: "home" });

  return (
    <main className="app-shell">
      {screen.name === "home" && (
        <HomeScreen
          childName={settings.childName}
          onPick={(gameId) => setScreen({ name: "game", gameId })}
          onOpenParent={() => setScreen({ name: "parent" })}
        />
      )}

      {screen.name === "game" && screen.gameId === "chat" && (
        <ChatScreen settings={settings} onExit={goHome} />
      )}

      {screen.name === "game" && screen.gameId !== "chat" && (
        <GameScreen gameId={screen.gameId} onExit={goHome} />
      )}

      {screen.name === "parent" && (
        <ParentPanel settings={settings} onChange={updateSettings} onExit={goHome} />
      )}
    </main>
  );
}
