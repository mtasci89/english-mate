/**
 * Leitner scheduling, kept deliberately small.
 *
 * Its job here is not clever scheduling — it is making sure the child does not
 * meet the same four words forever, and that a word answered from a picture
 * today comes back a few days later when recalling it actually costs something.
 */

const STORAGE_KEY = "english-mate-srs";

/** Box 0 returns within the session; later boxes in days. */
const BOX_INTERVALS_MS = [0, 864e5, 3 * 864e5, 7 * 864e5, 21 * 864e5];

export type ItemState = {
  box: number;
  dueAt: number;
  streak: number;
  seen: number;
};

type SrsMap = Record<string, ItemState>;

function load(): SrsMap {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as SrsMap) : {};
  } catch {
    return {};
  }
}

function save(map: SrsMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Scheduling degrades to "least recently seen" without storage. Acceptable.
  }
}

export function recordResult(key: string, accepted: boolean) {
  const map = load();
  const current = map[key] ?? { box: 0, dueAt: 0, streak: 0, seen: 0 };

  // A miss drops one box rather than resetting to zero: this is a six-year-old,
  // and one bad recognition should not erase a week of progress.
  const box = accepted
    ? Math.min(current.box + 1, BOX_INTERVALS_MS.length - 1)
    : Math.max(current.box - 1, 0);

  map[key] = {
    box,
    dueAt: Date.now() + BOX_INTERVALS_MS[box],
    streak: accepted ? current.streak + 1 : 0,
    seen: current.seen + 1,
  };

  save(map);
}

export function pickNext(keys: string[], exclude?: string | null) {
  const map = load();
  const now = Date.now();
  const pool = keys.filter((key) => key !== exclude);
  const candidates = pool.length ? pool : keys;

  const unseen = candidates.filter((key) => !map[key]);
  if (unseen.length) return unseen[Math.floor(Math.random() * unseen.length)];

  const due = candidates.filter((key) => (map[key]?.dueAt ?? 0) <= now);
  const bucket = due.length ? due : candidates;

  // Oldest due first, so nothing sits at the back of the queue forever.
  return bucket.reduce((oldest, key) =>
    (map[key]?.dueAt ?? 0) < (map[oldest]?.dueAt ?? 0) ? key : oldest,
  );
}

export function progressSummary(keys: string[]) {
  const map = load();
  let started = 0;
  let known = 0;

  for (const key of keys) {
    const state = map[key];
    if (!state) continue;
    started += 1;
    if (state.box >= 2) known += 1;
  }

  return { total: keys.length, started, known };
}
