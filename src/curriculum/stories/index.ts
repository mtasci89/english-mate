import catAndBird from "./animals-cat-and-bird.json";

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
 */
export type StoryLine = { id: string; text: string };

export type StoryQuestion = {
  id: string;
  /** Asked straight after this line. */
  after: string;
  text: string;
  target: string;
  distractors: string[];
  trHelp: string;
};

export type Story = {
  key: string;
  topic: string;
  title: string;
  lines: StoryLine[];
  questions: StoryQuestion[];
};

export const stories = [catAndBird] as Story[];

export const storiesByTopic = (topic: string) =>
  stories.filter((story) => story.topic === topic);

export const storyAudioKeys = {
  line: (storyKey: string, lineId: string) => `story-${storyKey}-${lineId}`,
  question: (storyKey: string, questionId: string) => `story-${storyKey}-${questionId}`,
};

/** Roughly how long a story runs, for fitting stories into a block's minutes. */
export function storySeconds(story: Story) {
  // Measured against the cached audio: a short line read slowly for a beginner
  // lands near three seconds, and each question costs a beat plus an answer.
  return story.lines.length * 3 + story.questions.length * 12;
}
