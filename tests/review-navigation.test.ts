import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  buildSolutionSteps,
  calculateNextStep,
} from "../src/features/review/solution";

describe("复习答案播放与左右键导航", () => {
  const start = new Chess().fen();
  const multiMoveSolution = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"];

  it("正确将多步 UCI 走法解析为每一步的 SAN 与更新后 FEN", () => {
    const steps = buildSolutionSteps(start, multiMoveSolution);
    expect(steps).toHaveLength(5);

    expect(steps[0].san).toBe("e4");
    expect(steps[0].uci).toBe("e2e4");
    expect(steps[0].fen).toContain(" b ");

    expect(steps[1].san).toBe("e5");
    expect(steps[1].fen).toContain(" w ");

    expect(steps[2].san).toBe("Nf3");
    expect(steps[3].san).toBe("Nc6");
    expect(steps[4].san).toBe("Bb5");
  });

  it("当 FEN 或走法为空时返回空数组", () => {
    expect(buildSolutionSteps(undefined, multiMoveSolution)).toEqual([]);
    expect(buildSolutionSteps(start, undefined)).toEqual([]);
    expect(buildSolutionSteps(start, [])).toEqual([]);
  });

  it("遇到非法走法时安全截断返回合法前缀", () => {
    const invalidSolution = ["e2e4", "e7e5", "g1g5"];
    const steps = buildSolutionSteps(start, invalidSolution);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.san)).toEqual(["e4", "e5"]);
  });

  it("calculateNextStep 正确计算左右方向键导航并在 [0, maxSteps] 内限制", () => {
    const maxSteps = 5;

    expect(calculateNextStep(0, 1, maxSteps)).toBe(1);
    expect(calculateNextStep(1, 1, maxSteps)).toBe(2);
    expect(calculateNextStep(4, 1, maxSteps)).toBe(5);
    expect(calculateNextStep(5, 1, maxSteps)).toBe(5);

    expect(calculateNextStep(5, -1, maxSteps)).toBe(4);
    expect(calculateNextStep(1, -1, maxSteps)).toBe(0);
    expect(calculateNextStep(0, -1, maxSteps)).toBe(0);
  });

  it("多步导航各步 FEN 能够单调演进并在退回到 0 时保留初始局面引用", () => {
    const steps = buildSolutionSteps(start, multiMoveSolution);

    let step = 0;
    expect(step === 0 ? start : steps[step - 1].fen).toBe(start);

    step = calculateNextStep(step, 1, steps.length);
    step = calculateNextStep(step, 1, steps.length);
    step = calculateNextStep(step, 1, steps.length);
    expect(step).toBe(3);
    expect(steps[step - 1].san).toBe("Nf3");

    step = calculateNextStep(step, -1, steps.length);
    expect(step).toBe(2);
    expect(steps[step - 1].san).toBe("e5");

    step = calculateNextStep(step, -1, steps.length);
    step = calculateNextStep(step, -1, steps.length);
    expect(step).toBe(0);
    expect(step === 0 ? start : steps[step - 1].fen).toBe(start);
  });
});
