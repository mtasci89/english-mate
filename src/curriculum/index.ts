import commandsData from "./commands.json";
import linesData from "./lines.json";
import wordsData from "./words.json";

export type Command = {
  key: string;
  en: string;
  tr: string;
  visual: string;
};

export type Unit = "animals" | "food" | "toys" | "vehicles" | "nature" | "colors";

export type Word = {
  key: string;
  en: string;
  tr: string;
  unit: Unit;
  visual: string;
  distractors: string[];
  /** Turkish takes no article here: "Bu su", not "Bu bir su". */
  mass?: boolean;
  /**
   * Colours are drawn as a swatch of this value rather than shown as an emoji.
   * The coloured-circle emoji read as a ball, which collided with the actual
   * ball card and made "what colour is this?" look like a trick question.
   */
  color?: string;
};

export type Line = { key: string; text: string };

export const commands = commandsData as Command[];
export const words = wordsData as Word[];
export const lines = linesData as {
  moveIntro: Line;
  nameIntro: Line;
  askWhat: Line[];
  askColour: Line[];
  askGap: Line[];
  praise: Line[];
  close: Line[];
  listening: Line[];
  modelListen: Line;
  modelNowYou: Line;
  moveOn: Line[];
  actionDone: Line[];
  sessionEnd: Line;
};

export const commandKeys = commands.map((command) => command.key);
export const wordKeys = words.map((word) => word.key);
export const wordByKey = new Map(words.map((word) => [word.key, word]));
export const commandByKey = new Map(commands.map((command) => [command.key, command]));

/*
 * Audio keys are derived, not stored, so the app and `scripts/build-audio.mjs`
 * cannot drift apart: both compute them from the same curriculum JSON.
 */
export const audioKeys = {
  commandEn: (key: string) => `cmd-${key}-en`,
  commandTr: (key: string) => `cmd-${key}-tr`,
  wordEn: (key: string) => `word-${key}-en`,
  wordTr: (key: string) => `word-${key}-tr`,
  wordSay: (key: string) => `word-${key}-say-en`,
};

/**
 * The Turkish half of the lifeline, and only the Turkish half.
 *
 * It carries no English word. The whole sentence is spoken by the Turkish
 * voice, which reads English spelling by Turkish rules — "kite" came out as
 * "kit" — and a voice speaks one language. The English follows as its own
 * utterance, in the English voice, where it is pronounced properly.
 *
 * "Bu bir kedi.", "Bu renk kırmızı.", "Bu su." — whichever the word takes.
 */
export function turkishHelpFor(word: Word) {
  const lead =
    word.unit === "colors"
      ? `Bu renk ${word.tr}`
      : word.mass
        ? `Bu ${word.tr}`
        : `Bu bir ${word.tr}`;
  return `${lead}.`;
}

export function englishRepeatFor(word: Word) {
  return `Say: ${word.en}.`;
}
