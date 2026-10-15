/**
 * Stories are the listening block.
 *
 * Producing English is the tiring part and a six-year-old is spent after ten
 * minutes of it; listening they will happily do for far longer. So the longest
 * block of the evening is one the child does not have to perform in — they
 * follow a story and answer a handful of easy questions along the way.
 *
 * Every line is rendered to audio ahead of time, which is what lets a
 * twenty-minute block cost nothing at runtime and never stall.
 *
 * Two kinds of story live here. Hand-written ones are read line by line from
 * the TTS cache. Books fetched from StoryWeaver (`scripts/fetch-stories.mjs`)
 * carry a human narrator instead: `audio` is one MP3 for the whole book and
 * each line is a page with its `start`/`end` slice of it.
 */
export type StoryLine = {
  id: string;
  text: string;
  /** Seconds into `Story.audio` where this page is read. */
  start?: number;
  end?: number;
  image?: string;
};

export type StoryQuestion = {
  id: string;
  /** Asked straight after this line. */
  after: string;
  text: string;
  target: string;
  distractors: string[];
  trHelp: string;
};

export type StorySource = {
  site: string;
  url: string;
  level: string | null;
  authors: string[];
  illustrators: string[];
  publisher: string | null;
  license: string;
  attribution: string;
};

export type Story = {
  key: string;
  topic: string;
  title: string;
  lines: StoryLine[];
  questions: StoryQuestion[];
  /** Narration for the whole book; lines are slices of it. */
  audio?: string;
  /** Fetched stories start unapproved; hand-written ones need no approval. */
  approved?: boolean;
  source?: StorySource;
  words?: number;
};

// Every JSON file in this folder is a story, so fetching one is enough to add
// it — no import list to keep in step.
const modules = import.meta.glob<Story>("./*.json", { eager: true, import: "default" });

export const stories: Story[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path]);

/*
 * A parent reads a fetched book before the child hears it. The tick is kept
 * on this device rather than in the JSON, so approving needs no rebuild; on
 * the box it will move to the brain's store with the rest of the programme.
 */
const APPROVALS_KEY = "english-mate-story-approvals";

function readApprovals(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(APPROVALS_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function isApproved(story: Story) {
  return readApprovals()[story.key] ?? story.approved ?? true;
}

export function setApproved(storyKey: string, approved: boolean) {
  try {
    localStorage.setItem(APPROVALS_KEY, JSON.stringify({ ...readApprovals(), [storyKey]: approved }));
  } catch {
    // Private mode: the tick lasts for this visit only.
  }
}

export const storiesByTopic = (topic: string) =>
  stories.filter((story) => story.topic === topic && isApproved(story));

export const storyAudioKeys = {
  line: (storyKey: string, lineId: string) => `story-${storyKey}-${lineId}`,
  question: (storyKey: string, questionId: string) => `story-${storyKey}-${questionId}`,
};

/**
 * StoryWeaver narrators read for native five-year-olds. A touch slower keeps
 * every word intact for a beginner without the stretched sound TTS gets.
 */
export const NARRATION_RATE = 0.85;

/** Roughly how long a story runs, for fitting stories into a block's minutes. */
export function storySeconds(story: Story) {
  const questions = story.questions.length * 12;
  if (story.audio) {
    const last = story.lines[story.lines.length - 1];
    return (last?.end ?? 0) / NARRATION_RATE + story.lines.length + questions;
  }
  // Measured against the cached audio: a short line read slowly for a beginner
  // lands near three seconds, and each question costs a beat plus an answer.
  return story.lines.length * 3 + questions;
}
