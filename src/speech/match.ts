/**
 * Constrained answer matching.
 *
 * The browser recogniser hands us free-form text, which is unreliable for a
 * six-year-old speaking a second language. But at every speech turn we already
 * know the small set of words the child could reasonably be saying, so the
 * question is never "what did this audio say" — it is "which of these few
 * candidates is it closest to". That is a far easier question, and it is what
 * makes a turn scoreable at all.
 */

const PUNCTUATION = /[.,!?;:"'`´()\[\]{}…]/g;

export type MatchResult = {
  /** True when the child said the target closely enough to move on. */
  accepted: boolean;
  /** Nearest candidate, target or distractor, or null when nothing was heard. */
  matched: string | null;
  /** 0..1 similarity to the target. Logged for the parent view, never shown to the child. */
  score: number;
  /** No usable speech came back. Silence is not a wrong answer. */
  silent: boolean;
};

export function normalizeAnswer(text: string) {
  return text
    .toLocaleLowerCase("en-US")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collapses spelling differences that survive a Turkish-accented English
 * transcription, so "tree" still matches "three" and "vater" matches "water".
 * Applied to both sides, so it only ever loosens the comparison.
 */
export function fold(word: string) {
  return word
    .replace(/th/g, "t")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/gh/g, "g")
    .replace(/wh/g, "w")
    .replace(/w/g, "v")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/(.)\1+/g, "$1")
    .replace(/e$/, "");
}

export function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }

  return previous[b.length];
}

function similarity(a: string, b: string) {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Short words are unforgiving under a ratio threshold — one slip in "cat" is a
 * third of the word — so the tolerance is expressed in edits instead.
 */
function allowedEdits(length: number) {
  if (length <= 3) return 1;
  if (length <= 6) return 2;
  return 3;
}

function scoreCandidate(heardTokens: string[], heardWhole: string, candidate: string) {
  const foldedCandidate = fold(candidate);
  let best = similarity(fold(heardWhole), foldedCandidate);
  let bestDistance = levenshtein(fold(heardWhole), foldedCandidate);

  for (const token of heardTokens) {
    const foldedToken = fold(token);
    if (foldedToken === foldedCandidate) return { score: 1, distance: 0 };

    const distance = levenshtein(foldedToken, foldedCandidate);
    const tokenScore = similarity(foldedToken, foldedCandidate);
    if (tokenScore > best) best = tokenScore;
    if (distance < bestDistance) bestDistance = distance;
  }

  return { score: best, distance: bestDistance };
}

export function matchAnswer(
  heard: string,
  target: string,
  distractors: string[] = [],
): MatchResult {
  const normalized = normalizeAnswer(heard);
  if (!normalized) {
    return { accepted: false, matched: null, score: 0, silent: true };
  }

  const tokens = normalized.split(" ");
  const candidates = [target, ...distractors];

  let bestCandidate = target;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let targetScore = 0;
  let targetDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const { score, distance } = scoreCandidate(tokens, normalized, normalizeAnswer(candidate));
    if (candidate === target) {
      targetScore = score;
      targetDistance = distance;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDistance = distance;
      bestCandidate = candidate;
    }
  }

  const withinTolerance = targetDistance <= allowedEdits(fold(normalizeAnswer(target)).length);
  const beatsDistractors = bestCandidate === target || targetScore >= bestScore;

  return {
    accepted: withinTolerance && beatsDistractors,
    matched: bestCandidate,
    score: Math.max(0, Math.min(1, targetScore)),
    silent: false,
  };
}
