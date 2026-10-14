import topicsData from "../curriculum/topics.json";

/**
 * The evening programme.
 *
 * The child chooses nothing. At session time the box announces the evening's
 * topic and runs its blocks in order — which is the whole point of the
 * redesign. Phase zero's gate used to be "will he ask for it?", the most
 * fragile assumption a toy can rest on; a ritual replaces it with "does he come
 * when called".
 */

export type Topic = {
  key: string;
  en: string;
  tr: string;
  words: string[];
  seeds: string[];
  /** Plain-language fence for the conversation model. */
  bounds: string;
};

export const topics = topicsData as Topic[];
export const topicByKey = new Map(topics.map((topic) => [topic.key, topic]));

export type BlockKind = "warmup" | "talk" | "story";

export type BlockSpec = { kind: BlockKind; minutes: number };

export type DayPlan = {
  topic: string;
  blocks: BlockSpec[];
};

/**
 * Default shape: short production, long listening.
 *
 * Twenty minutes of unbroken talking is beyond a beginner this age — they run
 * out at ten or twelve. This is a starting point, not a belief: the parent
 * panel reports completion per block, so the minutes move to fit the child
 * rather than the other way round.
 */
export const defaultBlocks: BlockSpec[] = [
  { kind: "warmup", minutes: 5 },
  { kind: "talk", minutes: 12 },
  { kind: "story", minutes: 18 },
];

/** Monday first, matching how a week is written down rather than Date.getDay(). */
export const weekdayNames = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const STORAGE_KEY = "english-mate-programme";

export type Programme = {
  /** Seven days, Monday first. */
  days: DayPlan[];
  /** When the box wakes, "HH:MM". Phase A only displays it; the Pi will act on it. */
  startAt: string;
};

export function defaultProgramme(): Programme {
  const order = ["animals", "vehicles", "food", "nature", "toys", "colors", "animals"];
  return {
    days: order.map((topic) => ({ topic, blocks: [...defaultBlocks] })),
    startAt: "19:30",
  };
}

export function readProgramme(): Programme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultProgramme();
    const parsed = JSON.parse(stored) as Programme;
    if (!Array.isArray(parsed.days) || parsed.days.length !== 7) return defaultProgramme();
    return parsed;
  } catch {
    return defaultProgramme();
  }
}

export function writeProgramme(programme: Programme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(programme));
  } catch {
    // Falls back to defaults next load; not worth failing a session over.
  }
}

/** Monday-first index for today. */
export function todayIndex(now = new Date()) {
  return (now.getDay() + 6) % 7;
}

export function tonight(programme = readProgramme(), now = new Date()) {
  const plan = programme.days[todayIndex(now)];
  const topic = topicByKey.get(plan.topic) ?? topics[0];
  return { plan, topic };
}
