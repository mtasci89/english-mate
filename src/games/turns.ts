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

} from "../curriculum";
import { gapKey, listGaps, type Gap } from "../curriculum/gaps";
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

/**
 * A card for a word the child reached for in Turkish during a conversation.
 *
 * There is no picture for these — they arrive as words, not as curriculum — so
 * the Turkish word itself is the card, and the child supplies the English. No
 * cached audio exists either, so the lines are spoken through the server to
 * keep the same voice as the rest of the game.
 */
function gapTurn(gap: Gap): Turn {
  return {
    gameId: "nameit",
    itemKey: gapKey(gap.en),
    visualText: gap.tr,
    expects: "speech",
    target: gap.en,
    distractors: [],
    prompt: line(pick(lines.askGap)),
    // Turkish only — the English word follows in the English voice, because a
    // Turkish voice reads English spelling by Turkish rules.
    trHelp: `Bu ${gap.tr} demek.`,
    englishRepeat: { text: `Say: ${gap.en}.`, lang: "en", preferRemote: true },
  };
}

export function nextNameTurn(previousKey: string | null): Turn {
  /*
   * Captured gaps come first, and often: the child has already demonstrated
   * they need these, which no curriculum ordering can tell us. They are still
   * mixed rather than exclusive, so a session does not become a list of
   * everything the child got wrong.
   */
  const gaps = listGaps().filter((gap) => gapKey(gap.en) !== previousKey);
  if (gaps.length && Math.random() < 0.4) {
    return gapTurn(pick(gaps));
  }

  const key = pickNext(wordKeys, previousKey);
  const word = wordByKey.get(key)!;

  return {
    gameId: "nameit",
    itemKey: key,
    visual: word.color ? undefined : word.visual,
    visualColor: word.color,
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
  turn: Turn,
): Feedback {
  // Curriculum words have a pre-rendered pronunciation; a word captured from
  // conversation does not, and is spoken through the server instead.
  const target = turn.target ?? "";
  const cached = wordByKey.get(turn.itemKey);
  const modelWord: Speakable = cached
    ? { text: cached.en, lang: "en", audioKey: audioKeys.wordEn(cached.key), rate: 0.6 }
    : { text: target, lang: "en", rate: 0.6, preferRemote: true };

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
    speakables: [line(lines.modelListen), modelWord, line(lines.modelNowYou)],
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
  // A captured-gap card has no rendered Turkish either, so it goes to the
  // server rather than dropping to the browser voice mid-game.
  const word = wordByKey.get(turn.itemKey);
  const cached = turn.gameId === "move" || Boolean(word);
  const trKey =
    turn.gameId === "move" ? audioKeys.commandTr(turn.itemKey) : audioKeys.wordTr(turn.itemKey);

  const turkish: Speakable = cached
    ? { text: turn.trHelp, lang: "tr", audioKey: trKey }
    : { text: turn.trHelp, lang: "tr", preferRemote: true };

  // Two utterances, never three. Saying the bare word and then "Say: bus."
  // made the toy repeat itself — "bus, say bus" — and the invitation already
  // contains the word, spoken by the English voice, which was the only reason
  // the bare one was added.
  return [turkish, turn.englishRepeat];
}

export function introFor(gameId: "move" | "nameit"): Speakable {
  return line(gameId === "move" ? lines.moveIntro : lines.nameIntro);
}

export function sessionEndLine(): Speakable {
  return line(lines.sessionEnd);
}
