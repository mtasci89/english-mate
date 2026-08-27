import type { Settings } from "./types";

const STORAGE_KEY = "english-mate-voice-settings";

export const levelLabels: Record<Settings["level"], string> = {
  early: "Word to phrase",
  sentence: "Full sentences",
  conversation: "Small conversation",
};

export const topicLabels: Record<Settings["topic"], string> = {
  daily: "Daily life",
  school: "School",
  family: "Family",
  feelings: "Feelings",
};

export const correctionLabels: Record<Settings["correctionStyle"], string> = {
  gentle: "Barely correct",
  balanced: "Natural recast",
  direct: "Clear recast",
};

export function defaultSettings(): Settings {
  return {
    childName: "My child",
    level: "sentence",
    topic: "daily",
    correctionStyle: "balanced",
    turkishBridge: true,
  };
}

export function readSettings(): Settings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultSettings();
    return { ...defaultSettings(), ...(JSON.parse(stored) as Partial<Settings>) };
  } catch {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode can refuse storage entirely; defaults still work.
    }
    return defaultSettings();
  }
}

export function writeSettings(settings: Settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Losing persistence is not worth breaking the session over.
  }
}
