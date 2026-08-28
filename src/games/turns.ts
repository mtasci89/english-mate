import {
  audioKeys,
  commandByKey,
  commandKeys,
  englishRepeatFor,
  lines,
  turkishHelpFor,
  wordByKey,
  wordKeys,
  type Line,
  type Word,
} from "../curriculum";
import { pickNext } from "../curriculum/srs";
import type { MatchResult } from "../speech/match";
import type { Speakable, Turn } from "../types";

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function line(source: Line): Speakable {
  return { text: source.text, lang: "en", audioKey: source.key };
}

export function nextMoveTurn(previousKey: string | null): Turn {
  const key = pickNext(commandKeys, previousKey);
  const command = commandByKey.get(key)!;

  return {
    gameId: "move",
    itemKey: key,
    visual: command.visual,
    expects: "action",
    prompt: { text: command.en, lang: "en", audioKey: audioKeys.commandEn(key) },
    trHelp: command.tr,
    englishRepeat: { text: command.en, lang: "en", audioKey: audioKeys.commandEn(key) },
  };
}

export function nextNameTurn(previousKey: string | null): Turn {
  const key = pickNext(wordKeys, previousKey);
  const word = wordByKey.get(key)!;

  return {
    gameId: "nameit",
    itemKey: key,
    visual: word.visual,
    expects: "speech",
    target: word.en,
    distractors: word.distractors,
    // Every colour is the same circle in a different shade, so "What is this?"
    // reads as a trick question. Asking for the colour makes the picture make
    // sense, and separates the two skills the child is actually practising.
    prompt: line(pick(word.unit === "colors" ? lines.askColour : lines.askWhat)),
    trHelp: turkishHelpFor(word),
    englishRepeat: {
      text: englishRepeatFor(word),
      lang: "en",
      audioKey: audioKeys.wordSay(key),
    },
  };
}

export type Feedback = {
  speakables: Speakable[];
  advance: boolean;
  nextHintLevel: number;
};

/**
 * The three-tier response ladder.
 *
 * There is deliberately no fourth tier: the toy never tells the child they are
 * wrong. A run of misses ends in encouragement and a new picture, because the
 * cost of discouraging a six-year-old is far higher than the cost of letting
 * one word go unlearned today — it will come back through the scheduler.
 */
export function feedbackForSpeech(
  result: MatchResult,
  hintLevel: number,
  word: Word,
): Feedback {
  if (result.accepted) {
    return { speakables: [line(pick(lines.praise))], advance: true, nextHintLevel: 0 };
  }

  if (hintLevel >= 2) {
    return { speakables: [line(pick(lines.moveOn))], advance: true, nextHintLevel: 0 };
  }

  // Silence is not a miss: the child gets an invitation, not a correction.
  if (result.silent) {
    return {
      speakables: [line(pick(lines.listening))],
      advance: false,
      nextHintLevel: hintLevel + 1,
    };
  }

  if (hintLevel === 0) {
    return {
      speakables: [line(pick(lines.close))],
      advance: false,
      nextHintLevel: 1,
    };
  }

  // Tier three: model the word, then hand the turn back. The word itself is
  // said slower still — this is the one moment the child is being asked to
  // copy a sound exactly, so clarity beats naturalness.
  return {
    speakables: [
      line(lines.modelListen),
      { text: word.en, lang: "en", audioKey: audioKeys.wordEn(word.key), rate: 0.6 },
      line(lines.modelNowYou),
    ],
    advance: false,
    nextHintLevel: 2,
  };
}

export function feedbackForAction(): Feedback {
  return { speakables: [line(pick(lines.actionDone))], advance: true, nextHintLevel: 0 };
}

/**
 * The Turkish lifeline, shaped so Turkish is a step and not an exit: the
 * explanation is always followed by the English again, and the child still owes
 * the turn an English answer.
 */
export function lifelineFor(turn: Turn): Speakable[] {
  const trKey =
    turn.gameId === "move" ? audioKeys.commandTr(turn.itemKey) : audioKeys.wordTr(turn.itemKey);

  return [
    { text: turn.trHelp, lang: "tr", audioKey: trKey },
    turn.englishRepeat,
  ];
}

export function introFor(gameId: "move" | "nameit"): Speakable {
  return line(gameId === "move" ? lines.moveIntro : lines.nameIntro);
}

export function sessionEndLine(): Speakable {
  return line(lines.sessionEnd);
}
