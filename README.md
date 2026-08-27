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
- Deterministic response logic so the first version works before adding an AI
  backend.

## Target Architecture

Both the phone interface and the physical toy should talk to the same backend.

1. Client records speech.
2. Backend transcribes audio.
3. Conversation engine detects whether the child used English or asked for
   Turkish help.
4. AI coach returns one short response: correction, expansion, or follow-up
   question.
5. Text-to-speech returns audio.
6. Phone or toy plays the audio response.

## Hardware Path

1. Keep the first version web-based for fast iteration.
2. Add a Raspberry Pi 5 or small Linux device for the physical toy.
3. Attach USB microphone, small speaker, one large button, and status LED.
4. Optionally use an ESP32 or Arduino board for extra buttons, RFID cards, or
   sensors.
5. Point the toy firmware at the same backend used by the phone.
