type SpeechRecognitionAlternative = { transcript: string; confidence: number };

type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
};

type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResult };
};

type SpeechRecognitionErrorEvent = Event & { error: string };

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function speechRecognitionSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export type RecognizerOptions = {
  lang: string;
  onPartial: (text: string) => void;
  /** Called once per hold, with "" when the child stayed silent. */
  onFinal: (text: string) => void;
  /** Microphone blocked — the only recogniser problem worth telling a parent about. */
  onDenied: () => void;
};

export type Recognizer = {
  /**
   * Spin the engine up before the child presses.
   *
   * Constructing a recogniser and starting capture takes the browser a few
   * hundred milliseconds, and a child who presses and talks immediately loses
   * the first word to that gap — then has to repeat themselves, which is the
   * one thing this toy must not make them do.
   */
  arm: () => void;
  /**
   * The press. Everything captured while merely armed is discarded here, so
   * arming early can never put stray room noise into the answer.
   */
  start: () => void;
  stop: () => void;
  cancel: () => void;
};

/**
 * Hold-to-talk wrapper around the browser recogniser.
 *
 * The child decides when the turn ends by releasing the button, not the
 * engine's silence timer — a child who pauses mid-thought must not be cut off.
 * Silence is delivered as an empty final rather than an error: hesitating is
 * not a mistake, and the toy must never react to it as one.
 */
export function createRecognizer(options: RecognizerOptions): Recognizer {
  const availableConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!availableConstructor) {
    return { arm: () => {}, start: () => options.onFinal(""), stop: () => {}, cancel: () => {} };
  }
  // Bind to a non-optional local so the nested `start()` closure below does
  // not re-widen this back to `SpeechRecognitionConstructor | undefined`.
  const SpeechRecognition: SpeechRecognitionConstructor = availableConstructor;

  let instance: SpeechRecognitionInstance | null = null;
  let finalText = "";
  let interimText = "";
  let delivered = false;
  let cancelled = false;
  /** Engine is up and should stay up, restarting itself if the browser stops it. */
  let armed = false;
  /** The child is pressing: what is captured from here on is the answer. */
  let holding = false;

  function deliver() {
    if (delivered) return;
    delivered = true;
    options.onFinal([finalText, interimText].join(" ").replace(/\s+/g, " ").trim());
  }

  function arm() {
    if (armed) return;
    armed = true;
    cancelled = false;
    launch();
  }

  function start() {
    // Drop anything heard before the press, so an early-armed microphone can
    // never feed room noise into the answer.
    finalText = "";
    interimText = "";
    delivered = false;
    holding = true;

    // Normally the engine is already running from arm(); this covers a press
    // that beat it, or a browser that stopped it.
    if (!instance) launch();
  }

  function launch() {
    const recognition = new SpeechRecognition();
    instance = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = options.lang;

    recognition.onresult = (event) => {
      interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalText = `${finalText} ${transcript}`.trim();
        } else {
          interimText = `${interimText} ${transcript}`.trim();
        }
      }
      options.onPartial([finalText, interimText].join(" ").replace(/\s+/g, " ").trim());
    };

    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        delivered = true;
        options.onDenied();
        return;
      }
      // "no-speech", "aborted" and friends mean we simply have nothing — which
      // the caller handles as silence, gently, rather than as a failure.
    };

    recognition.onend = () => {
      if (cancelled) return;
      instance = null;

      // Browsers stop a "continuous" session on their own after a stretch of
      // silence. While armed and not yet holding, that would quietly disarm the
      // microphone before the child ever pressed, so it is restarted.
      if (armed && !holding) {
        launch();
        return;
      }

      deliver();
    };

    try {
      recognition.start();
    } catch {
      // Chrome throws if start() lands while a previous session is still
      // winding down; the release will simply deliver empty text.
    }
  }

  function stopInstance() {
    if (!instance) return;
    try {
      instance.stop();
    } catch {
      // Already stopped.
    }
  }

  function stop() {
    if (!holding) return;
    holding = false;
    armed = false;
    stopInstance();
    // Some engines never fire `onend` after a very short hold.
    window.setTimeout(deliver, 400);
  }

  function cancel() {
    cancelled = true;
    delivered = true;
    armed = false;
    holding = false;
    if (!instance) return;
    try {
      instance.abort();
    } catch {
      // Nothing to abort.
    }
    instance = null;
  }

  return { arm, start, stop, cancel };
}
