import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script, no type declarations
import { parseVtt, toStory, validQuestions } from "./fetch-stories.mjs";

// Shaped like StoryWeaver's own files: loose arrows, a last cue that runs on.
const vtt = `WEBVTT

1
00:00:00.000 --> 00:00:01.000
The

2
00:00:01.000--> 00:00:01.500
cat

3
00:00:01.500 --> 00:00:03.000
sat.

4
00:00:03.000--> 00:01:03.000
Look!`;

const page = (cues: [number, string][]) =>
  `<p>${cues.map(([cue, word]) => `<span data-cue="${cue}">${word}</span>`).join(" ")}</p>`;

const read = {
  ok: true,
  data: {
    slug: "1-the-cat",
    level: "1",
    isPublisher: true,
    audioPath: "https://example.test/1-the-cat.mp3",
    authors: [{ name: "A. Writer" }],
    pages: [
      { pageType: "FrontCoverPage", html: "<p>The Cat</p>" },
      { pageType: "StoryPage", html: page([[1, "The"], [2, "cat"], [3, "sat."]]), coverImage: { sizes: [{ url: "s1" }, { url: "s2" }] } },
      { pageType: "StoryPage", html: page([[4, "Look!"]]) },
      { pageType: "BackInnerCoverPage", html: "<p>This story: The Cat is written by A. Writer. Released under CC BY 4.0 license.</p>" },
    ],
  },
};

describe("fetch-stories", () => {
  it("parses loose VTT and clamps the runaway last cue", () => {
    const cues = parseVtt(vtt);
    expect(cues.get(2)).toEqual([1, 1.5]);
    expect(cues.get(4)).toEqual([3, 5.5]);
  });

  it("turns story pages into timed lines with credits", () => {
    const story = toStory(read, vtt, { topic: "animals" });
    expect(story.key).toBe("sw-1-the-cat");
    expect(story.title).toBe("The Cat");
    expect(story.approved).toBe(false);
    expect(story.audio).toBe(read.data.audioPath);
    expect(story.source.license).toBe("CC BY 4.0");
    expect(story.lines).toEqual([
      { id: "p01", text: "The cat sat.", start: 0, end: 3, image: "s2" },
      { id: "p02", text: "Look!", start: 3, end: 5.5 },
    ]);
  });

  it("keeps only questions whose answer was already heard", () => {
    const story = toStory(read, vtt, { topic: "animals" });
    const kept = validQuestions(story, [
      { after: "p01", text: "Who sat?", target: "Cat", distractors: ["dog", "cat", "bird"], trHelp: "Kim oturdu?" },
      { after: "p01", text: "Again?", target: "cat", distractors: ["dog", "bird"], trHelp: "Yine?" },
      { after: "p02", text: "Last page?", target: "look", distractors: ["dog", "bird"], trHelp: "Son?" },
    ]);
    expect(kept).toEqual([
      { id: "q1", after: "p01", text: "Who sat?", target: "cat", distractors: ["dog", "bird"], trHelp: "Kim oturdu?" },
    ]);
  });
});
