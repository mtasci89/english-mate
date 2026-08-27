import { describe, expect, it } from "vitest";
import { matchAnswer } from "./match";

describe("matchAnswer", () => {
  it("accepts an exact match", () => {
    const result = matchAnswer("cat", "cat", []);
    expect(result.accepted).toBe(true);
    expect(result.score).toBe(1);
  });

  it("accepts the target spoken inside a sentence", () => {
    const result = matchAnswer("it's a cat", "cat", []);
    expect(result.accepted).toBe(true);
  });

  it("rejects a different candidate and reports which one was heard", () => {
    const result = matchAnswer("dog", "cat", ["dog", "cow", "duck"]);
    expect(result.accepted).toBe(false);
    expect(result.matched).toBe("dog");
  });

  it("treats silence as silent, not wrong", () => {
    const result = matchAnswer("", "cat", []);
    expect(result.silent).toBe(true);
    expect(result.accepted).toBe(false);
  });

  it("folds th -> t so 'tree' matches 'three'", () => {
    const result = matchAnswer("tree", "three", []);
    expect(result.accepted).toBe(true);
  });

  it("folds w -> v so 'vater' matches 'water'", () => {
    const result = matchAnswer("vater", "water", []);
    expect(result.accepted).toBe(true);
  });

  it("rejects 'ship' against target 'sheep' when 'ship' is a listed distractor", () => {
    const result = matchAnswer("ship", "sheep", ["ship"]);
    expect(result.accepted).toBe(false);
  });

  it("rejects 'horse' against target 'house' when 'horse' is a listed distractor", () => {
    const result = matchAnswer("horse", "house", ["horse"]);
    expect(result.accepted).toBe(false);
  });
});
