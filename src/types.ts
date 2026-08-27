export type Level = "early" | "sentence" | "conversation";
export type CorrectionStyle = "gentle" | "balanced" | "direct";
export type Topic = "daily" | "school" | "family" | "feelings";
export type EngineState = "ready" | "listening" | "thinking" | "speaking";

/** The three modes, ordered by how much English the child has to produce. */
export type GameId = "move" | "nameit" | "chat";

export type Settings = {
  childName: string;
  level: Level;
  topic: Topic;
  correctionStyle: CorrectionStyle;
  turkishBridge: boolean;
};

export type Message = {
  role: "child" | "assistant";
  text: string;
  lang: "en" | "tr";
};

/**
 * Anything the toy says out loud. `audioKey` names a pre-rendered file under
 * `public/audio/`; when it is missing the player falls back to the browser
 * voice, so a turn never blocks on audio being built.
 */
export type Speakable = {
  text: string;
  lang: "en" | "tr";
  audioKey?: string;
  /** Overrides the default browser-voice pace, e.g. a word being modelled. */
  rate?: number;
};

/** What the child is expected to do in response to a prompt. */
export type Expectation = "action" | "speech" | "free";

export type Turn = {
  gameId: GameId;
  prompt: Speakable;
  /** Large glyph shown with the prompt. Emoji keeps the prototype asset-free. */
  visual?: string;
  expects: Expectation;
  /** Speech turns only: the word we are listening for. */
  target?: string;
  /** Speech turns only: the other words the answer is scored against. */
  distractors?: string[];
  /** Turkish explanation, given only when the child asks for it. */
  trHelp: string;
  /** Said in English straight after the Turkish help, so Turkish never ends a turn. */
  englishRepeat: Speakable;
  /** Curriculum key, used for spaced repetition and the attempt log. */
  itemKey: string;
};

export type Attempt = {
  ts: number;
  sessionId: string;
  game: GameId;
  itemKey: string;
  target: string | null;
  heard: string | null;
  accepted: boolean;
  score: number | null;
  /** True when the child pressed "I don't understand" during this turn. */
  trLifeline: boolean;
  /** How many times the prompt was replayed before the answer. */
  hintLevel: number;
  latencyMs: number | null;
};
