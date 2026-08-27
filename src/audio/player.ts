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

/*
 * Browser voice fallback.
 *
 * Setting `utterance.lang` alone is not enough: if the device has no voice
 * installed for that language, the browser will happily accept the utterance
 * and say nothing at all. That is why Turkish came out silent on a device with
 * no Turkish voice. A voice is now always picked explicitly, and when the
 * requested language has none we deliberately speak with whatever voice exists
 * rather than going quiet — a heavily accented sentence still reaches the child
 * and the parent sitting next to them, silence does not.
 */

/** Slow enough for a beginner to catch each word; adult conversation pace is not. */
const RATE_EN = 0.72;
/** The language the child already has: normal pace, not patronising. */
const RATE_TR = 0.95;

/** Names that usually indicate a neural voice rather than the old robotic one. */
const QUALITY_HINTS = ["natural", "neural", "enhanced", "premium", "google", "siri"];

let voices: SpeechSynthesisVoice[] = [];
let voicesLoad: Promise<void> | null = null;

export function loadVoices(): Promise<void> {
  if (voicesLoad) return voicesLoad;

  voicesLoad = new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }

    const read = () => {
      voices = window.speechSynthesis.getVoices();
      return voices.length > 0;
    };

    if (read()) {
      resolve();
      return;
    }

    // Chrome populates the list asynchronously, after `voiceschanged`.
    const onChanged = () => {
      read();
      window.speechSynthesis.removeEventListener("voiceschanged", onChanged);
      resolve();
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChanged);
    window.setTimeout(() => {
      read();
      resolve();
    }, 1500);
  });

  return voicesLoad;
}

function score(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  let value = QUALITY_HINTS.some((hint) => name.includes(hint)) ? 2 : 0;
  if (voice.localService) value += 1;
  return value;
}

function pickVoice(lang: "en" | "tr") {
  const prefix = lang === "tr" ? "tr" : "en";
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
  if (!matching.length) return null;

  return matching.reduce((best, voice) => (score(voice) > score(best) ? voice : best));
}

/** Surfaced in the parent panel so a missing Turkish voice reads as a device gap, not a bug. */
export function turkishVoiceAvailable() {
  return pickVoice("tr") !== null;
}

function speakWithBrowserVoice(speakable: Speakable, onEnd: () => void) {
  if (!("speechSynthesis" in window)) {
    onEnd();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(speakable.text);
  const preferred = pickVoice(speakable.lang);

  if (preferred) {
    utterance.voice = preferred;
    utterance.lang = preferred.lang;
  } else {
    // No voice for this language on this device. Fall back to any voice at all
    // rather than letting the utterance play silently.
    const anyVoice = pickVoice("en") ?? voices[0] ?? null;
    if (anyVoice) utterance.voice = anyVoice;
    if (anyVoice) utterance.lang = anyVoice.lang;
  }

  utterance.rate = speakable.rate ?? (speakable.lang === "tr" ? RATE_TR : RATE_EN);
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
