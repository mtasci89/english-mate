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
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return { start: () => options.onFinal(""), stop: () => {}, cancel: () => {} };
  }

  let instance: SpeechRecognitionInstance | null = null;
  let finalText = "";
  let interimText = "";
  let delivered = false;
  let cancelled = false;

  function deliver() {
    if (delivered) return;
    delivered = true;
    options.onFinal([finalText, interimText].join(" ").replace(/\s+/g, " ").trim());
  }

  function start() {
    stopInstance();

    const recognition = new SpeechRecognition();
    instance = recognition;
    finalText = "";
    interimText = "";
    delivered = false;
    cancelled = false;

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
    stopInstance();
    // Some engines never fire `onend` after a very short hold.
    window.setTimeout(deliver, 400);
  }

  function cancel() {
    cancelled = true;
    delivered = true;
    if (!instance) return;
    try {
      instance.abort();
    } catch {
      // Nothing to abort.
    }
    instance = null;
  }

  return { start, stop, cancel };
}
