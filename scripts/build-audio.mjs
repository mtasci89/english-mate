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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
 * Google Cloud Text-to-Speech (Chirp 3 HD).
 *
 * Same voice family as the Gemini engine — Leda is one of the eight Chirp 3 HD
 * voices — but billed per character rather than per request, which is the
 * difference between a catalogue that builds in one run and one that takes
 * twelve days. Sulafat is Gemini-only, so Turkish uses Aoede here.
 *
 * Pace is set through `speakingRate` rather than a style prompt: a number the
 * API honours exactly, instead of an instruction the model interprets.
 */
const GCLOUD_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
const GCLOUD_VOICE_EN = process.env.GCLOUD_VOICE_EN || "en-US-Chirp3-HD-Leda";
const GCLOUD_VOICE_TR = process.env.GCLOUD_VOICE_TR || "tr-TR-Chirp3-HD-Aoede";
/** Slow enough for a beginner to catch each word; 1.0 is conversational. */
const GCLOUD_RATE_EN = Number(process.env.GCLOUD_RATE_EN) || 0.8;
const GCLOUD_RATE_TR = Number(process.env.GCLOUD_RATE_TR) || 1.0;

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

/**
 * Which synthesiser to use.
 *
 * `gcloud` (the default) is Google Cloud Text-to-Speech: metered per character
 * with a free monthly allowance that dwarfs this catalogue, and its Chirp 3 HD
 * line includes the same Leda voice the Gemini engine uses.
 *
 * `gemini` is the same voice family through the Gemini API, whose free tier
 * meters ten requests per day — unusable for a hundred-odd files, so it is no
 * longer the default. `say` is the local macOS fallback.
 */
const ENGINE =
  (process.argv.find((arg) => arg.startsWith("--engine=")) ?? "").replace("--engine=", "") ||
  "gcloud";
const ENGINES = new Set(["gcloud", "gemini", "say"]);

/*
 * `--only=cat,line-ask` builds just the keys containing those substrings.
 *
 * At three requests a minute the full catalogue takes well over half an hour,
 * which is a long time to wait before finding out the voice is wrong. This
 * makes a three-file audition cheap: pick the voice first, then commit to the
 * full run.
 */
const ONLY = (process.argv.find((arg) => arg.startsWith("--only=")) ?? "")
  .replace("--only=", "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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
  const lead =
    word.unit === "colors"
      ? `Bu renk ${word.tr}`
      : word.mass
        ? `Bu ${word.tr}`
        : `Bu bir ${word.tr}`;
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
    ...lines.askColour,
    ...lines.askGap,
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

// Cloud TTS returns encoded mp3 directly, so that engine never needs ffmpeg.
// Gemini and `say` hand back raw PCM, which only becomes mp3 with ffmpeg;
// without it they write a valid .wav instead. The format is recorded in the
// manifest and the player reads it from there, so no branch requires editing
// the app: ffmpeg is a size optimisation, never a prerequisite.
const OUTPUT_EXT = ENGINE === "gcloud" || FFMPEG_AVAILABLE ? "mp3" : "wav";

if (!FFMPEG_AVAILABLE && ENGINE !== "gcloud") {
  console.warn(
    "[build-audio] ffmpeg not found on PATH: writing .wav instead of .mp3. " +
      "This works as-is — the manifest records the format and the app follows " +
      "it. Install ffmpeg and re-run with --force only if you want smaller files.",
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

/*
 * Rate limiting.
 *
 * The free tier allows three TTS requests per minute per model. Firing the
 * whole catalogue as fast as the loop can go earns four files and a hundred
 * 429s, so requests are spaced out and a 429 is waited out rather than counted
 * as a failure. Set TTS_RPM higher on a paid key to go faster.
 */
// Cloud TTS quotas are per character and generous per minute; the Gemini free
// tier is three requests a minute, so the default follows the engine.
const RPM = Math.max(1, Number(process.env.TTS_RPM) || (ENGINE === "gcloud" ? 60 : 3));
const MIN_INTERVAL_MS = Math.ceil(60000 / RPM);
const MAX_RETRIES = 5;

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Google reports how long to wait; honouring it beats guessing. */
function retryDelayFromBody(body) {
  const structured = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (structured) return Math.ceil(Number(structured[1]) * 1000);

  const prose = /retry in (\d+(?:\.\d+)?)s/i.exec(body);
  return prose ? Math.ceil(Number(prose[1]) * 1000) : null;
}

/**
 * A per-day quota is not something waiting fixes.
 *
 * The free tier allows ten TTS requests a day, so retrying a daily refusal
 * burns five minutes per key and still fails — a full catalogue would sit there
 * for hours pretending to make progress. Daily refusals abort the run instead.
 */
function isDailyQuota(body) {
  return /PerDay/i.test(body);
}

async function throttle() {
  // The local engine has no quota to pace against.
  if (ENGINE === "say") return;

  const waitMs = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (waitMs > 0) await sleep(waitMs);
  lastRequestAt = Date.now();
}

async function synthesizeWithRetry(text, lang, apiKey, onWait) {
  for (let attempt = 1; ; attempt += 1) {
    await throttle();
    try {
      return await synthesize(text, lang, apiKey);
    } catch (error) {
      if (error.dailyQuota) throw error;

      const rateLimited = error.status === 429;
      if (!rateLimited || attempt > MAX_RETRIES) throw error;

      // Fall back to a widening wait when Google does not say how long.
      const waitMs = error.retryAfterMs ?? attempt * 20000;
      onWait?.(waitMs, attempt);
      await sleep(waitMs + 1000);
    }
  }
}

/*
 * macOS `say` engine.
 *
 * Gemini's free tier allows ten TTS requests a day, which cannot build a
 * hundred-odd file catalogue — twelve days of runs. macOS ships a perfectly
 * good speech synthesiser with a Turkish voice, no key, no quota and no
 * network, so `--engine=say` builds the whole catalogue in seconds.
 *
 * Pace is set in words per minute rather than by a style prompt: English slow
 * enough for a beginner to catch each word, Turkish at a normal pace.
 */
const SAY_VOICE_EN = process.env.SAY_VOICE_EN || "Samantha";
const SAY_VOICE_TR = process.env.SAY_VOICE_TR || "Yelda";
const SAY_RATE_EN = Number(process.env.SAY_RATE_EN) || 130;
const SAY_RATE_TR = Number(process.env.SAY_RATE_TR) || 165;

function sayVoiceAvailable(voice) {
  try {
    const listed = execFileSync("say", ["-v", "?"], { encoding: "utf8" });
    return listed.split("\n").some((line) => line.startsWith(`${voice} `));
  } catch {
    return false;
  }
}

function synthesizeWithSay(text, lang) {
  const voice = lang === "tr" ? SAY_VOICE_TR : SAY_VOICE_EN;
  const rate = lang === "tr" ? SAY_RATE_TR : SAY_RATE_EN;
  const tempPath = join(AUDIO_DIR, `.say-${process.pid}.wav`);

  const result = spawnSync(
    "say",
    ["-v", voice, "-r", String(rate), "-o", tempPath, "--data-format=LEI16@24000", text],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    const detail = (result.stderr || "").trim().slice(-300);
    throw new Error(`say failed for voice "${voice}": ${detail || "unknown error"}`);
  }

  const wav = readFileSync(tempPath);
  rmSync(tempPath, { force: true });

  return FFMPEG_AVAILABLE ? wavToMp3(wav) : wav;
}

async function synthesizeWithGcloud(text, lang, apiKey) {
  const response = await fetch(GCLOUD_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: lang === "tr" ? "tr-TR" : "en-US",
        name: lang === "tr" ? GCLOUD_VOICE_TR : GCLOUD_VOICE_EN,
      },
      audioConfig: {
        // The API encodes mp3 for us, so this engine needs no ffmpeg.
        audioEncoding: "MP3",
        speakingRate: lang === "tr" ? GCLOUD_RATE_TR : GCLOUD_RATE_EN,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Cloud TTS request failed (${response.status}): ${detail}`);
    error.status = response.status;
    error.retryAfterMs = retryDelayFromBody(detail);
    error.dailyQuota = response.status === 429 && isDailyQuota(detail);
    throw error;
  }

  const data = await response.json();
  if (!data.audioContent) throw new Error("Cloud TTS response had no audioContent");

  return Buffer.from(data.audioContent, "base64");
}

async function synthesize(text, lang, apiKey) {
  if (ENGINE === "say") return synthesizeWithSay(text, lang);
  if (ENGINE === "gcloud") return synthesizeWithGcloud(text, lang, apiKey);

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
    const error = new Error(`Gemini TTS request failed (${response.status}): ${detail}`);
    error.status = response.status;
    error.retryAfterMs = retryDelayFromBody(detail);
    error.dailyQuota = response.status === 429 && isDailyQuota(detail);
    throw error;
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
  if (!ENGINES.has(ENGINE)) {
    console.error(
      `[build-audio] unknown --engine=${ENGINE}. Use ${[...ENGINES].join(", ")}.`,
    );
    process.exitCode = 1;
    return;
  }

  // One Google Cloud API key with both APIs enabled serves either engine, so
  // GEMINI_API_KEY is accepted as a fallback rather than demanding a second one.
  const apiKey =
    ENGINE === "gcloud"
      ? process.env.GOOGLE_TTS_API_KEY || process.env.GEMINI_API_KEY
      : process.env.GEMINI_API_KEY;

  if (ENGINE !== "say" && !apiKey) {
    const expected = ENGINE === "gcloud" ? "GOOGLE_TTS_API_KEY (or GEMINI_API_KEY)" : "GEMINI_API_KEY";
    console.error(`${expected} is not set. Export it, or use --engine=say.`);
    process.exitCode = 1;
    return;
  }

  if (ENGINE === "say") {
    const missing = [SAY_VOICE_EN, SAY_VOICE_TR].filter((voice) => !sayVoiceAvailable(voice));
    if (missing.length) {
      console.error(
        `[build-audio] macOS voice(s) not installed: ${missing.join(", ")}. ` +
          "List what you have with `say -v '?'`, then set SAY_VOICE_EN / SAY_VOICE_TR. " +
          "More voices install under System Settings → Accessibility → Spoken Content.",
      );
      process.exitCode = 1;
      return;
    }
  }

  mkdirSync(AUDIO_DIR, { recursive: true });

  const allJobs = collectJobs();
  const jobs = ONLY.length
    ? allJobs.filter((job) => ONLY.some((needle) => job.key.includes(needle)))
    : allJobs;

  if (!jobs.length) {
    console.error(`[build-audio] --only=${ONLY.join(",")} matched no keys.`);
    process.exitCode = 1;
    return;
  }

  let builtCount = 0;
  let skippedCount = 0;
  const failed = [];

  // Progress is printed per key, not just on failure. At three requests a
  // minute this run takes a long time, and a silent cursor for that long is
  // indistinguishable from a hang — the run gets killed by someone reasonably
  // assuming it died.
  const pending = FORCE
    ? jobs.length
    : jobs.filter((job) => !existsSync(join(AUDIO_DIR, `${job.key}.${OUTPUT_EXT}`))).length;
  if (ENGINE === "say") {
    console.log(
      `[build-audio] engine: macOS say (${SAY_VOICE_EN} / ${SAY_VOICE_TR}). ` +
        `${jobs.length} keys selected, ${pending} to synthesize.`,
    );
  } else {
    const estimateMinutes = Math.ceil((pending * MIN_INTERVAL_MS) / 60000);
    const label =
      ENGINE === "gcloud"
        ? `Cloud TTS (${GCLOUD_VOICE_EN} / ${GCLOUD_VOICE_TR})`
        : `Gemini (${VOICE_EN} / ${VOICE_TR})`;
    console.log(
      `[build-audio] engine: ${label}. ${jobs.length} keys selected, ${pending} to ` +
        `synthesize at ${RPM} requests/minute — roughly ${estimateMinutes} minute(s). ` +
        "Raise TTS_RPM to go faster. Safe to interrupt: finished files are kept.",
    );
  }

  let index = 0;
  for (const job of jobs) {
    const outPath = join(AUDIO_DIR, `${job.key}.${OUTPUT_EXT}`);
    index += 1;
    const position = `${String(index).padStart(3)}/${jobs.length}`;

    if (!FORCE && existsSync(outPath)) {
      skippedCount += 1;
      console.log(`[build-audio] ${position} ${job.key} — already on disk, skipped`);
      continue;
    }

    try {
      const audio = await synthesizeWithRetry(job.text, job.lang, apiKey, (waitMs, attempt) => {
        console.log(
          `[build-audio] ${position} ${job.key} — rate limited, waiting ` +
            `${Math.ceil(waitMs / 1000)}s (attempt ${attempt}/${MAX_RETRIES})`,
        );
      });
      writeFileSync(outPath, audio);
      builtCount += 1;
      console.log(`[build-audio] ${position} ${job.key} — ${(audio.length / 1024).toFixed(0)} KB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ key: job.key, message });
      console.error(`[build-audio] skipped "${job.key}": ${message}`);

      if (error.dailyQuota) {
        console.error(
          "[build-audio] Daily Gemini TTS quota is spent — the free tier allows ten " +
            "requests a day, so the remaining keys cannot be built today. Re-run with " +
            "--engine=say to build them all locally now, or come back tomorrow. " +
            "Files already written are kept and will be skipped next time.",
        );
        break;
      }
    }
  }

  // The manifest lists every key that currently has a playable file on disk
  // — not just the ones this run touched — so a partial or repeated run
  // still leaves the app able to use whatever has succeeded so far.
  // Built from the full catalogue, not this run's selection: a `--only` run
  // must not drop keys that other runs already produced.
  const manifestKeys = allJobs
    .map((job) => job.key)
    .filter((key) => existsSync(join(AUDIO_DIR, `${key}.${OUTPUT_EXT}`)));

  // Format travels with the key list so the app plays whatever was actually
  // written, whether or not ffmpeg was on this machine.
  const manifest = { format: OUTPUT_EXT, keys: manifestKeys };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

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
