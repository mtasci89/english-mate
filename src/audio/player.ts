import type { Speakable } from "../types";

/**
 * Prompt playback, cache first.
 *
 * Every fixed prompt in the two structured games is pre-rendered to a file by
 * `scripts/build-audio.mjs`, so saying it costs a cache hit rather than a
 * synthesis round trip. That is what keeps a turn inside the ~300ms a young
 * child will wait. The browser voice remains as a fallback, so an unbuilt
 * prompt degrades in quality instead of breaking the game.
 */

let manifest: Set<string> | null = null;
let manifestLoad: Promise<Set<string>> | null = null;
const preloaded = new Map<string, HTMLAudioElement>();
let current: HTMLAudioElement | null = null;

export function loadManifest(): Promise<Set<string>> {
  if (manifestLoad) return manifestLoad;

  manifestLoad = fetch("/audio/manifest.json")
    .then((response) => (response.ok ? response.json() : []))
    .then((keys: unknown) => {
      manifest = new Set(Array.isArray(keys) ? keys.map(String) : []);
      return manifest;
    })
    .catch(() => {
      manifest = new Set<string>();
      return manifest;
    });

  return manifestLoad;
}

function hasAudio(key: string | undefined): key is string {
  return Boolean(key && manifest?.has(key));
}

function elementFor(key: string) {
  const existing = preloaded.get(key);
  if (existing) return existing;

  const audio = new Audio(`/audio/${key}.mp3`);
  audio.preload = "auto";
  preloaded.set(key, audio);
  return audio;
}

/** Warms the next prompts so the following turn starts without a network wait. */
export function preload(speakables: Speakable[]) {
  for (const speakable of speakables) {
    if (hasAudio(speakable.audioKey)) elementFor(speakable.audioKey).load();
  }
}

export function cancelSpeech() {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function speakWithBrowserVoice(speakable: Speakable, onEnd: () => void) {
  if (!("speechSynthesis" in window)) {
    onEnd();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(speakable.text);
  utterance.lang = speakable.lang === "tr" ? "tr-TR" : "en-US";
  // Slower in English: this is the language being learned, not the one already known.
  utterance.rate = speakable.lang === "tr" ? 0.95 : 0.82;
  utterance.pitch = 1.02;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

/** Resolves when the prompt has finished playing. */
export function speak(speakable: Speakable): Promise<void> {
  cancelSpeech();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      current = null;
      resolve();
    };

    if (!hasAudio(speakable.audioKey)) {
      speakWithBrowserVoice(speakable, finish);
      return;
    }

    const audio = elementFor(speakable.audioKey);
    audio.currentTime = 0;
    audio.onended = finish;
    audio.onerror = () => {
      // The manifest promised a file that will not play; fall back rather than
      // leaving the child in silence.
      manifest?.delete(speakable.audioKey as string);
      speakWithBrowserVoice(speakable, finish);
    };
    current = audio;

    const started = audio.play();
    if (started) started.catch(() => speakWithBrowserVoice(speakable, finish));
  });
}
