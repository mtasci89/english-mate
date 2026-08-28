/**
 * Words the child reached for in Turkish.
 *
 * When a Turkish word appears inside an English sentence, the child has shown
 * exactly which word they are missing — better evidence of what to teach next
 * than any fixed curriculum order. These are captured from free chat and dealt
 * back into Name It, so the conversation decides what the games drill.
 *
 * Stored per device alongside the spaced-repetition state; losing them costs
 * nothing that a few more conversations will not replace.
 */

const STORAGE_KEY = "english-mate-gaps";
/** Enough to keep the deck fresh without burying the curriculum. */
const LIMIT = 40;

export type Gap = {
  /** The Turkish word, shown on the card. */
  tr: string;
  /** The English word the child needs to produce. */
  en: string;
  /** First seen; used to retire the oldest when the list is full. */
  ts: number;
};

function load(): Gap[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? (JSON.parse(stored) as Gap[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(gaps: Gap[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(gaps.slice(-LIMIT)));
  } catch {
    // Storage refused; the next conversation will offer them again.
  }
}

export function listGaps(): Gap[] {
  return load();
}

/** Keyed by the English word, so the same gap reached for twice stays one card. */
export function recordGaps(found: { tr: string; en: string }[]) {
  if (!found.length) return;

  const existing = load();
  const known = new Set(existing.map((gap) => gap.en));
  const added = found
    .filter((gap) => gap.en && gap.tr && !known.has(gap.en))
    .map((gap) => ({ tr: gap.tr, en: gap.en, ts: Date.now() }));

  if (added.length) save([...existing, ...added]);
}

/**
 * Dropped once the child produces it unaided: the gap is closed, and leaving it
 * in the deck would spend turns on a word they already have.
 */
export function clearGap(en: string) {
  save(load().filter((gap) => gap.en !== en));
}

export const gapKey = (en: string) => `gap-${en}`;
