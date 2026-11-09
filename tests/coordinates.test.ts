import { describe, expect, it } from "vitest";
import {
  coordinateSession as reduce,
  coordinateSquares,
  initialCoordinateSession as initial,
} from "../src/features/visualization/coordinates";
const start = () => reduce(initial, { type: "start", now: 1000, random: 0 });
describe("coordinate training", () => {
  it("lays out the board from a8 to h1 with all 64 squares", () => {
    expect(coordinateSquares[0]).toBe("a8");
    expect(coordinateSquares[56]).toBe("a1");
    expect(new Set(coordinateSquares).size).toBe(64);
  });
  it("scores only correct answers and never repeats the current target", () => {
    const state = start();
    const wrong = reduce(state, {
      type: "answer",
      now: 2000,
      square: "h1",
      random: 0,
    });
    expect(wrong).toMatchObject({
      score: 0,
      target: state.target,
      wrong: "h1",
    });
    const correct = reduce(wrong, {
      type: "answer",
      now: 3000,
      square: state.target,
      random: 0,
    });
    expect(correct.score).toBe(1);
    expect(correct.target).not.toBe(state.target);
    expect(correct.wrong).toBeNull();
  });
  it("rejects answers at the deadline even if the timer callback was delayed", () => {
    for (const now of [31000, 60000]) {
      const state = start();
      expect(
        reduce(state, { type: "answer", now, square: state.target, random: 0 }),
      ).toMatchObject({ status: "finished", score: 0, remaining: 0 });
    }
    const state = start();
    expect(
      reduce(state, {
        type: "answer",
        now: 30999,
        square: state.target,
        random: 0,
      }).score,
    ).toBe(1);
  });
  it("expires across background delays, ignores clicks after finishing, and resets on restart", () => {
    const done = reduce(start(), { type: "tick", now: 90000 });
    expect(
      reduce(done, {
        type: "answer",
        now: 90001,
        square: done.target,
        random: 0,
      }),
    ).toBe(done);
    expect(
      reduce(
        { ...done, score: 12 },
        { type: "start", now: 100000, random: 0.99 },
      ),
    ).toMatchObject({
      status: "running",
      score: 0,
      remaining: 30000,
      deadline: 130000,
      wrong: null,
    });
  });
});
