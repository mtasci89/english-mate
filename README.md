# English Mate

English Mate is a mobile-first language toy prototype for children learning
English. The child talks to a friendly buddy, gets short English prompts, and can
switch to Turkish help when they are stuck.

## Product Shape

- Child screen: one large talk button, a friendly toy face, visual quests, target
  words, and replay.
- Parent strip: level, play world, and Turkish bridge controls.
- First learning mode: deterministic, browser-only practice that works without an
  AI backend.
- Next learning mode: connect the same UI to a speech-to-text, LLM, and TTS
  backend.

## Hardware Roadmap

1. Web app on phone or tablet.
2. Raspberry Pi 5 with a USB microphone, small speaker, one large button, and an
   LED ring.
3. Optional ESP32 or Arduino board for RFID cards, buttons, lights, and sensors.
4. Optional local model workstation backend for private inference.

## Language Design

The target language is English. Turkish is used as a bridge only when the child
asks for help or switches the listening mode to Turkish help. The toy should then
give a short Turkish reassurance and bring the child back to an English sentence.
