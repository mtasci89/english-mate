# English Mate

English Mate is a voice-first English practice toy for a six-year-old
Turkish-speaking child. The first interface runs in a mobile/tablet browser.
The same engine is intended to power a later physical toy with a microphone,
speaker, button, and simple status light.

## Product Goal

Help the child improve spoken English through short, safe, repeated
conversations. Turkish is not the target language; it is only a support
bridge when the child gets stuck or asks for help.

## The three modes, and why this order

The home screen offers three games, presented as a ladder — each one asks the
child to produce more English than the last:

1. **Move With Me** (`move`) — the toy gives a spoken command ("Touch your
   nose."), the child acts it out, and presses "Done" themselves. No speech
   is expected from the child at all. This is the easiest possible mode: it
   builds comprehension and comfort with the toy's voice before the child has
   to produce any English of their own.
2. **Name It** (`nameit`) — the toy shows a picture and asks "What is this?".
   The child says one word, held-to-talk, and it is matched against a known
   set of candidates (see below). This is the first mode that asks for
   spoken English, but the vocabulary is small, fixed, and drilled.
3. **Talk With Me** (`chat`) — free, open-ended conversation with Gemini.
   This is the only mode with unbounded input and output, so it is offered
   last, once the child has warmed up on the two structured games.

This order is a deliberate design constraint, not just a UI choice:

- **`move` and `nameit` never make a network call.** Every prompt they speak
  is a pre-rendered audio file (see below), and every answer they score is
  matched against a small, known candidate list — never trusted as free
  transcription. Both are things that can run offline and be graded
  reliably.
- **`chat` is the only mode that calls Gemini**, both to generate the
  assistant's reply and, implicitly, to accept whatever the child says. It is
  the one place where the app cannot guarantee what happens, which is exactly
  why it is the last rung of the ladder rather than the front door.

## Answer matching (`src/speech/match.ts`)

The browser's speech recognizer returns free-form, often noisy text — doubly
so for a child speaking a second language. `move` and `nameit` never trust
that text directly. Instead, at every turn the app already knows the small
set of words the child could reasonably be saying (the target plus a short
list of curriculum distractors), and `matchAnswer()` asks only "which of
these few candidates is this closest to" — folding common Turkish-accented
spelling slips (`th`→`t`, `w`→`v`, …) and scoring by Levenshtein distance
with a length-aware edit-count tolerance, then requiring the target to beat
every distractor, not just clear an absolute threshold. See
`src/speech/match.test.ts` for the cases this is expected to get right,
including two that exist specifically to catch a matcher that would accept a
near-miss distractor (`ship` vs. target `sheep`, `horse` vs. target `house`).

## Hold-to-talk

The child ends their turn by releasing a button, not by the speech engine's
own silence timeout (`src/speech/recognition.ts`). A pause mid-sentence never
gets treated as "finished," and silence on release is reported back as
"nothing heard," not as an error — see `matchAnswer`'s `silent` result and
the `listening` lines in `src/curriculum/lines.json`.

## Feedback has three tiers, never a fourth

Every scored turn resolves to one of exactly three outcomes — accepted
("Perfect!"), a near miss that gets modeled once more ("So close" → "Listen.
cat. Now you."), or a graceful move-on after repeated tries ("Good trying,
let's look at another one!"). There is no fourth tier that tells the child
they are wrong; see `src/games/turns.ts`.

## The Turkish lifeline

Pressing "I don't understand" never ends a turn in Turkish. It plays a short
Turkish explanation and is **always** immediately followed by the English
phrase again, with the answer still owed in English (`englishRepeat` in
`src/types.ts`, wired in `src/games/turns.ts`). The parent panel's "Turkish
help used" figure is meant to trend down over weeks; see below.

## Voice cache

`move` and `nameit` speak from pre-rendered audio files, never from
on-the-fly synthesis, so that they can honor "no network call at runtime."

- `npm run build:audio` runs `scripts/build-audio.mjs` **locally**, once
  (or after the curriculum JSON changes), against Google AI Studio's TTS
  model (`gemini-2.5-flash-preview-tts`) using a `GEMINI_API_KEY` you export
  in your own shell. It renders every fixed command, word, and stock line
  from `src/curriculum/*.json` to `public/audio/<key>.<format>`, using one
  consistent voice for English lines and a different consistent voice for
  Turkish lines, and writes `public/audio/manifest.json` — `{ format, keys }`,
  listing every key that has a file. It is idempotent (skips a key whose file
  already exists) unless you pass `--force`, and a single key's TTS failure
  is logged and skipped rather than aborting the run.
- **ffmpeg is optional.** With it the output is mp3; without it the output is
  wav, roughly ten times larger but equally playable. The manifest records
  which, and the player follows it, so nothing in the app needs editing either
  way.
- **Two engines.** `--engine=gemini` (default) needs `GEMINI_API_KEY`; the free
  tier allows **ten TTS requests per day**, which cannot build this catalogue in
  one sitting — a daily refusal aborts the run rather than retrying for hours.
  `--engine=say` uses the local macOS synthesiser: no key, no quota, no network,
  whole catalogue in seconds. Override its voices with `SAY_VOICE_EN` /
  `SAY_VOICE_TR` and its pace (words per minute) with `SAY_RATE_EN` /
  `SAY_RATE_TR`; `say -v '?'` lists what the machine has.
- **`--only=<substrings>`** builds just the matching keys — a three-file
  audition before committing to a full run. The manifest is still written from
  the full catalogue, so a partial run never drops keys other runs produced.
- **This script is intentionally not part of `npm run build` or the Netlify
  build.** Audio files are generated by a person, once, and **committed to
  the repo** like any other asset — never generated during deploy.
- `src/audio/player.ts` reads `manifest.json` on startup and only ever plays
  a cached file if the manifest says it exists. If a key's file is missing
  (audio not built yet, or a TTS call failed), the player falls back to the
  browser's `speechSynthesis` voice for that one prompt — lower quality, but
  the game keeps working instead of going silent.

## `GEMINI_API_KEY` — two separate uses

The same environment variable name is used in two different places, for two
different purposes, and neither reads the other's copy:

1. **At runtime**, in the Netlify Function `netlify/functions/chat.mjs`,
   read from Netlify's environment variables, for `chat` mode's live
   conversation with Gemini. Set it in the Netlify site's environment
   variables (see Deployment below).
2. **Locally only**, exported in your own shell before running
   `npm run build:audio`, for one-time text-to-speech generation. This run
   never happens on Netlify's build machine and never touches production
   traffic.

## Privacy note (read this before shipping to a real child)

This is a conscious Phase 0.5 tradeoff, not an oversight:

- **The browser's speech recognition API sends the child's voice recording
  to the browser vendor's servers** (e.g. Google's, in Chrome) to be
  transcribed. English Mate does not choose this — it is how the Web Speech
  API works — and there is currently no on-device alternative wired in.
- **The `attempts` log writes the child's already-transcribed text** — what
  was heard, whether it was accepted, the target word, a score — to Netlify
  Blobs via `/api/attempts` (`netlify/functions/attempts.mjs`), so the
  parent panel and any later analysis can see it. Raw audio is never sent
  there, only text.
- Phase 1's plan is to replace both of these with a local/on-device model,
  which removes the need to send the child's speech or its transcript
  anywhere. Until then, treat this build as sending data off-device and
  configure Netlify Blobs access accordingly.

## Netlify Deployment

Set this environment variable in Netlify:

```txt
GEMINI_API_KEY=your_google_ai_studio_key
```

Optional:

```txt
GEMINI_MODEL=gemini-2.0-flash
```

Netlify build settings:

```txt
Build command: npm run build:netlify
Publish directory: netlify-dist
Functions directory: netlify/functions
```

Netlify Blobs (used by `/api/attempts`) works automatically inside a
deployed Netlify site; no separate setup is required beyond the
`@netlify/blobs` dependency already in `package.json`. Outside of a deployed
Netlify context (e.g. `npm run dev`), the function catches the failure and
reports `stored: false` / `source: "unavailable"` rather than erroring, and
the client keeps its own local ring buffer (`localStorage`) so the parent
panel still has numbers to show.

## Parent panel numbers and the Phase 0 exit criteria

The parent panel's stat grid leads with four numbers sourced from the
attempts log (`src/telemetry.ts`'s `Summary`), because these are what the
Phase 0 go/no-go decision rests on — not vocabulary size, but whether the
child actually uses and benefits from the toy:

- **Rounds this week** (`summary.sessions`) — distinct sessions in the
  window. Answers whether the child is coming back on their own.
- **Answers heard** (`summary.attempts`) — how many scored turns happened at
  all. A low number relative to rounds means turns are stalling, not that
  the child is failing them.
- **Accepted** (`summary.acceptRate`) — the share of scored turns the
  matcher accepted. Too low and the level or matcher is too strict; too high
  (100%) for too long and the level is too easy to be useful.
- **Turkish help used** (`summary.lifelineRate`) — how often the lifeline is
  pressed. This is expected to trend down over weeks as the child gets more
  comfortable; a flat or rising trend is the signal that the current level
  is too hard.

The remaining two tiles, "Words started" and "Words sticking", come from the
separate Leitner-box vocabulary tracker (`src/curriculum/srs.ts`) rather than
the attempts log, and describe curriculum coverage rather than the
engagement question the four numbers above are meant to answer.

## Hardware Path

1. Keep the first version web-based for fast iteration.
2. Add a Raspberry Pi 5 or small Linux device for the physical toy.
3. Attach USB microphone, small speaker, one large button, and status LED.
4. Optionally use an ESP32 or Arduino board for extra buttons, RFID cards, or
   sensors.
5. Point the toy firmware at the same backend used by the phone.
