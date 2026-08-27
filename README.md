# English Mate

English Mate is a voice-first English practice engine for a child. The first
interface runs in a mobile browser. The same engine is intended to power a later
physical toy with a microphone, speaker, button, and simple status light.

## Product Goal

Help the child improve spoken English through short, safe, repeated
conversations. Turkish is not the target language; it is only a support bridge
when the child gets stuck or asks for help.

## Current Prototype

- Mobile-friendly voice practice screen.
- Parent panel for level, topic, correction style, and Turkish bridge.
- Browser speech recognition for capturing the child's answer.
- Browser text-to-speech for reading prompts and responses aloud.
- Gemini Flash chat backend through a Netlify Function, with a deterministic
  fallback if the environment variable is missing.

## Target Architecture

Both the phone interface and the physical toy should talk to the same backend.

1. Client records speech.
2. The browser speech API turns it into text for the first prototype.
3. The frontend sends text, parent settings, and recent conversation to
   `/api/chat`.
4. The Netlify Function calls Gemini Flash with `GEMINI_API_KEY`.
5. Gemini returns one short natural spoken response.
6. Phone or toy plays the response with text-to-speech.

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

## Hardware Path

1. Keep the first version web-based for fast iteration.
2. Add a Raspberry Pi 5 or small Linux device for the physical toy.
3. Attach USB microphone, small speaker, one large button, and status LED.
4. Optionally use an ESP32 or Arduino board for extra buttons, RFID cards, or
   sensors.
5. Point the toy firmware at the same backend used by the phone.
