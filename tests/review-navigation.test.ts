import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { parsePuzzleAnswers } from "../src/features/puzzles/answers";
import {
  isWaitingForReply,
  playPuzzleMove,
  playPuzzleReply,
} from "../src/features/review/attempt";
import {
  buildSolutionSteps,
  calculateInitialSolutionStep,
  calculateNextStep,
  resolveReviewBoardFen,
} from "../src/features/review/solution";
import type { Puzzle } from "../src/shared/types";

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

  it("多步题中途答错后显示答案时从当前已走步数开始，并从下一步继续播放", () => {
    const afterB3 = new Chess();
    afterB3.move("b3");
    const fen = afterB3.fen();
    const puzzle: Puzzle = {
      id: "multi-b3",
      category: "opening",
      sourceType: "manual",
      sourceGameId: null,
      sourceMoveId: null,
      fen,
      sideToMove: "black",
      title: "1. b3 多步练习",
      description: "",
      originalMove: null,
      ...parsePuzzleAnswers(
        fen,
        "Nf6 Bb2 c5 e3 Nc6 Nf3 g6 d4 cxd4 Nxd4 Bg7",
        true,
      ),
      errorCategory: null,
    };

    const steps = buildSolutionSteps(puzzle.fen, puzzle.solutionLine);
    expect(steps).toHaveLength(11);

    let attempt = playPuzzleMove(puzzle, null, "g8", "f6");
    expect(attempt?.correct).toBe(true);
    attempt = attempt ? playPuzzleReply(puzzle, attempt) : null;

    attempt = playPuzzleMove(puzzle, attempt, "c7", "c5");
    expect(attempt?.correct).toBe(true);
    attempt = attempt ? playPuzzleReply(puzzle, attempt) : null;

    attempt = playPuzzleMove(puzzle, attempt, "b8", "c6");
    expect(attempt?.correct).toBe(true);
    expect(isWaitingForReply(attempt)).toBe(true);
    expect(attempt?.moves).toHaveLength(5);

    attempt = attempt ? playPuzzleReply(puzzle, attempt) : null;
    expect(attempt?.moves).toHaveLength(6);

    const wrongAttempt = playPuzzleMove(puzzle, attempt, "d7", "d5");
    expect(wrongAttempt).not.toBeNull();
    expect(wrongAttempt?.correct).toBe(false);
    expect(wrongAttempt?.moves).toHaveLength(6);

    const initialStep = calculateInitialSolutionStep(
      wrongAttempt?.moves.length ?? 0,
      steps.length,
    );
    expect(initialStep).toBe(6);
    expect(steps[initialStep - 1]?.fen).toBe(wrongAttempt?.fen);

    const nextStep = calculateNextStep(initialStep, 1, steps.length);
    expect(nextStep).toBe(7);
    expect(steps[nextStep - 1]?.san).toBe("g6");
  });

  it("calculateInitialSolutionStep 处理零步、等待应手奇数步以及越界限制", () => {
    expect(calculateInitialSolutionStep(0, 11)).toBe(0);
    expect(calculateInitialSolutionStep(5, 11)).toBe(5);
    expect(calculateInitialSolutionStep(15, 11)).toBe(11);
    expect(calculateInitialSolutionStep(-2, 11)).toBe(0);
    expect(calculateInitialSolutionStep(3, 0)).toBe(0);
  });

  it("resolveReviewBoardFen 在空队列、做题、答错、完成、显示答案与步骤导航下返回正确局面", () => {
    const afterE4 = new Chess();
    afterE4.move("e4");
    const fen = afterE4.fen();
    const puzzle: Puzzle = {
      id: "multi-e4",
      category: "opening",
      sourceType: "manual",
      sourceGameId: null,
      sourceMoveId: null,
      fen,
      sideToMove: "black",
      title: "1. e4 多步练习",
      description: "",
      originalMove: null,
      ...parsePuzzleAnswers(fen, "c5 Nf3 d6", true),
      errorCategory: null,
    };
    const steps = buildSolutionSteps(puzzle.fen, puzzle.solutionLine);
    expect(steps).toHaveLength(3);

    expect(
      resolveReviewBoardFen({
        puzzleFen: undefined,
        attemptFen: steps[0].fen,
        answerShown: true,
        solutionStep: 1,
        solutionSteps: steps,
      }),
    ).toBeUndefined();

    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: undefined,
        answerShown: false,
        solutionStep: 0,
        solutionSteps: steps,
      }),
    ).toBe(puzzle.fen);

    let attempt = playPuzzleMove(puzzle, null, "c7", "c5");
    expect(attempt?.correct).toBe(true);
    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: attempt?.fen,
        answerShown: false,
        solutionStep: 0,
        solutionSteps: steps,
      }),
    ).toBe(steps[0].fen);

    attempt = attempt ? playPuzzleReply(puzzle, attempt) : null;
    expect(attempt?.complete).toBe(false);
    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: attempt?.fen,
        answerShown: false,
        solutionStep: 0,
        solutionSteps: steps,
      }),
    ).toBe(steps[1].fen);

    const wrongAttempt = playPuzzleMove(puzzle, attempt, "e7", "e5");
    expect(wrongAttempt?.correct).toBe(false);
    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: wrongAttempt?.fen,
        answerShown: false,
        solutionStep: 0,
        solutionSteps: steps,
      }),
    ).toBe(steps[1].fen);

    const midStep = calculateInitialSolutionStep(
      wrongAttempt?.moves.length ?? 0,
      steps.length,
    );
    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: wrongAttempt?.fen,
        answerShown: true,
        solutionStep: midStep,
        solutionSteps: steps,
      }),
    ).toBe(steps[1].fen);

    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: wrongAttempt?.fen,
        answerShown: true,
        solutionStep: 0,
        solutionSteps: steps,
      }),
    ).toBe(puzzle.fen);

    const solvedAttempt = playPuzzleMove(puzzle, attempt, "d7", "d6");
    expect(solvedAttempt?.complete).toBe(true);
    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: solvedAttempt?.fen,
        answerShown: false,
        solutionStep: 0,
        solutionSteps: steps,
      }),
    ).toBe(steps[2].fen);

    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: solvedAttempt?.fen,
        answerShown: false,
        solutionStep: 1,
        solutionSteps: steps,
      }),
    ).toBe(steps[0].fen);

    expect(
      resolveReviewBoardFen({
        puzzleFen: puzzle.fen,
        attemptFen: solvedAttempt?.fen,
        answerShown: true,
        solutionStep: 99,
        solutionSteps: steps,
      }),
    ).toBe(puzzle.fen);
  });
});
