#!/usr/bin/env node
/**
 * Voice cache builder (K1: structured games never call a speech API at
 * runtime).
 *
 * Renders every fixed prompt used by the `move` and `nameit` games to
 * `public/audio/<key>.mp3` once, ahead of time. The running app only ever
 * reads these files (see `src/audio/player.ts`); it never synthesizes
 * speech itself except as a last-resort fallback when a file is missing.
 * `chat` mode is the only mode allowed to talk to a model at runtime, and it
 * does not use this cache at all.
 *
 * Usage:
 *   GEMINI_API_KEY=... node scripts/build-audio.mjs [--force]
 *
 * Without `--force`, a key whose output file already exists on disk is left
 * alone (idempotent re-runs). `--force` re-renders every key.
 *
 * This script is intentionally NOT wired into `npm run build` or the
 * Netlify build. Audio files are generated locally, once, and committed to
 * the repo — they are not produced at deploy time.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const AUDIO_DIR = join(ROOT, "public", "audio");
const MANIFEST_PATH = join(AUDIO_DIR, "manifest.json");

// If Google renames or retires this model, calls below fail with a plain
// 404 and the script prints Google's own error text and skips the key. Fix
// that by updating this constant by hand — the script deliberately has no
// automatic fallback to a different model name.
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;

// One fixed voice per language. Keep these constant across runs: the child
// hears the same two "characters" every session, and changing a name here
// changes the voice the next time audio is (re)built.
//
// "Leda" is the youthful voice — a companion nearer the child's own age reads
// better here than an authoritative one. Turkish keeps a separate, warmer voice
// so the switch into the lifeline is audible: the helper stepping in should not
// sound like the English the child is here to practise.
const VOICE_EN = "Leda";
const VOICE_TR = "Sulafat";

/*
 * Delivery instructions.
 *
 * Voice choice alone does not fix pace, and pace is the thing that makes a
 * beginner able to follow at all. Gemini TTS takes a natural-language style
 * lead before the content and does not read that lead aloud — that is how the
 * English lines get the slow, over-articulated delivery of an adult reading a
 * picture book, rather than the speed of adult conversation.
 *
 * Turkish is the language the child already has, so it stays at a normal calm
 * pace; slowing it down would sound patronising instead of clear.
 */
const STYLE_EN =
  "Read the following slowly and very clearly, with a small pause between " +
  "words, in the warm and encouraging voice of a friendly teacher speaking to " +
  "a six-year-old who is just beginning to learn English. Gently " +
  "over-pronounce each word instead of speaking at natural conversational " +
  "speed.";

const STYLE_TR =
  "Bunu sakin, sıcak ve net bir sesle, bir çocuğa bir şeyi açıklar gibi, " +
  "normal konuşma hızında oku.";

const FORCE = process.argv.includes("--force");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const commands = readJson(join(ROOT, "src", "curriculum", "commands.json"));
const words = readJson(join(ROOT, "src", "curriculum", "words.json"));
const lines = readJson(join(ROOT, "src", "curriculum", "lines.json"));

/*
 * This mirrors `audioKeys` in `src/curriculum/index.ts` exactly, by
 * instruction: copied, not re-derived independently. If the two ever
 * disagree, the app will ask for a file this script never wrote (or vice
 * versa), so change both in the same commit.
 */
const audioKeys = {
  commandEn: (key) => `cmd-${key}-en`,
  commandTr: (key) => `cmd-${key}-tr`,
  wordEn: (key) => `word-${key}-en`,
  wordTr: (key) => `word-${key}-tr`,
  wordSay: (key) => `word-${key}-say-en`,
};

/**
 * Mirrors `turkishHelpFor()` in `src/curriculum/index.ts` exactly. If this
 * drifts from that function, the cached audio says a different sentence
 * than the one the app would synthesize on the fly, and the child hears
 * whichever one happens to load first.
 */
function turkishHelpFor(word) {
  const lead = word.unit === "colors" ? `Bu renk ${word.tr}` : `Bu bir ${word.tr}`;
  return `${lead}. İngilizcesi: ${word.en}.`;
}

/** Every {key, text, lang} that needs a rendered file, deduplicated by key. */
function collectJobs() {
  const jobs = [];
  const seen = new Set();
  const add = (key, text, lang) => {
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push({ key, text, lang });
  };

  const lineEntries = [
    lines.moveIntro,
    lines.nameIntro,
    ...lines.askWhat,
    ...lines.praise,
    ...lines.close,
    ...lines.listening,
    lines.modelListen,
    lines.modelNowYou,
    ...lines.moveOn,
    ...lines.actionDone,
    lines.sessionEnd,
  ];
  for (const line of lineEntries) {
    add(line.key, line.text, "en");
  }

  for (const command of commands) {
    add(audioKeys.commandEn(command.key), command.en, "en");
    add(audioKeys.commandTr(command.key), command.tr, "tr");
  }

  for (const word of words) {
    add(audioKeys.wordEn(word.key), word.en, "en");
    add(audioKeys.wordTr(word.key), turkishHelpFor(word), "tr");
    add(audioKeys.wordSay(word.key), `Say: ${word.en}.`, "en");
  }

  return jobs;
}

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const FFMPEG_AVAILABLE = hasFfmpeg();

// Gemini TTS returns raw PCM; turning that into an mp3 needs ffmpeg. Without
// it we still write a valid, playable file — just a .wav — rather than
// failing outright. If this branch is the one that actually ran, the
// extension below no longer matches what `src/audio/player.ts` requests: go
// change the extension in `elementFor()` (the only place it is hardcoded)
// before shipping these files.
const OUTPUT_EXT = FFMPEG_AVAILABLE ? "mp3" : "wav";

if (!FFMPEG_AVAILABLE) {
  console.warn(
    "[build-audio] ffmpeg not found on PATH: writing .wav files instead of " +
      ".mp3. src/audio/player.ts hardcodes the .mp3 extension in " +
      "elementFor() — update that one line to '.wav' if you ship files " +
      "built this way.",
  );
}

/** Wraps raw 16-bit PCM samples in a minimal RIFF/WAVE header. */
function pcmToWav(pcm, sampleRate, channels = 1, bitsPerSample = 16) {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20); // audio format: 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** Reads the PCM sample rate Gemini reports, e.g. "audio/L16;rate=24000". */
function sampleRateFromMimeType(mimeType) {
  const match = /rate=(\d+)/.exec(mimeType || "");
  return match ? Number(match[1]) : 24000;
}

function wavToMp3(wavBuffer) {
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-i", "pipe:0", "-f", "mp3", "-codec:a", "libmp3lame", "-qscale:a", "4", "pipe:1"],
    { input: wavBuffer, maxBuffer: 1024 * 1024 * 64 },
  );
  if (result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString("utf8").slice(-500) : "";
    throw new Error(`ffmpeg exited with status ${result.status}: ${detail}`);
  }
  return result.stdout;
}

async function synthesize(text, lang, apiKey) {
  const voiceName = lang === "tr" ? VOICE_TR : VOICE_EN;
  const style = lang === "tr" ? STYLE_TR : STYLE_EN;
  const styledPrompt = `${style}\n\n${text}`;

  const response = await fetch(`${TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: styledPrompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    }),
  });

  if (!response.ok) {
    // Printed as-is, including a 404 from a renamed/retired model: no
    // silent retry against a different model name.
    const detail = await response.text();
    throw new Error(`Gemini TTS request failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const part = data?.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData);
  const inline = part?.inlineData;
  if (!inline?.data) {
    throw new Error("Gemini TTS response had no inline audio data");
  }

  const pcm = Buffer.from(inline.data, "base64");
  const sampleRate = sampleRateFromMimeType(inline.mimeType);
  const wav = pcmToWav(pcm, sampleRate);

  return FFMPEG_AVAILABLE ? wavToMp3(wav) : wav;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. Export it before running this script.");
    process.exitCode = 1;
    return;
  }

  mkdirSync(AUDIO_DIR, { recursive: true });

  const jobs = collectJobs();
  let builtCount = 0;
  let skippedCount = 0;
  const failed = [];

  for (const job of jobs) {
    const outPath = join(AUDIO_DIR, `${job.key}.${OUTPUT_EXT}`);

    if (!FORCE && existsSync(outPath)) {
      skippedCount += 1;
      continue;
    }

    try {
      const audio = await synthesize(job.text, job.lang, apiKey);
      writeFileSync(outPath, audio);
      builtCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ key: job.key, message });
      console.error(`[build-audio] skipped "${job.key}": ${message}`);
    }
  }

  // The manifest lists every key that currently has a playable file on disk
  // — not just the ones this run touched — so a partial or repeated run
  // still leaves the app able to use whatever has succeeded so far.
  const manifestKeys = jobs
    .map((job) => job.key)
    .filter((key) => existsSync(join(AUDIO_DIR, `${key}.${OUTPUT_EXT}`)));

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifestKeys, null, 2)}\n`);

  console.log(
    `[build-audio] built ${builtCount}, skipped ${skippedCount} (already existed), ` +
      `failed ${failed.length}, manifest now lists ${manifestKeys.length} keys.`,
  );
  if (failed.length) {
    console.log("[build-audio] failed keys:");
    for (const { key, message } of failed) console.log(`  - ${key}: ${message}`);
  }
}

main().catch((error) => {
  console.error("[build-audio] unexpected failure:", error);
  process.exitCode = 1;
});
