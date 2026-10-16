import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  parsePuzzleAnswers,
  isMultiMovePuzzle,
} from "../src/features/puzzles/answers";
import { playPuzzleMove } from "../src/features/review/attempt";
import type { Puzzle } from "../src/shared/types";

const start = new Chess().fen();
function puzzle(text = "e4 e5 Nf3 Nc6 Bb5", fen = start): Puzzle {
  return {
    id: "multi",
    category: "opening",
    sourceType: "manual",
    sourceGameId: null,
    sourceMoveId: null,
    fen,
    sideToMove: fen.split(" ")[1] === "w" ? "white" : "black",
    title: "连续多步",
    description: "",
    originalMove: null,
    ...parsePuzzleAnswers(fen, text, true),
    errorCategory: null,
  };
}

describe("多步题目录入", () => {
  it("按更新后的局面校验 SAN 和混合 UCI，保存首步和完整答案", () => {
    expect(parsePuzzleAnswers(start, "e4 e7e5 Nf3", true)).toEqual({
      expectedMoves: ["e2e4"],
      solutionLine: ["e2e4", "e7e5", "g1f3"],
    });
    expect(parsePuzzleAnswers(start, "  e2e4\ne5，g1f3  ", true)).toEqual(
      parsePuzzleAnswers(start, "e4 e5 Nf3", true),
    );
  });
  it("拒绝非法中间步骤，指出具体位置；不接受空答案", () => {
    expect(() => parsePuzzleAnswers(start, "e4 Nf3", true)).toThrow(
      "第 2 步「Nf3」",
    );
    expect(() => parsePuzzleAnswers(start, "e4 e5 e4", true)).toThrow(
      "第 3 步「e4」",
    );
    expect(() => parsePuzzleAnswers(start, " ", true)).toThrow("请输入");
  });
  it("保持单步多答案语义，互不顺序执行", () => {
    expect(parsePuzzleAnswers(start, "e4, d4 Nf3", false)).toEqual({
      expectedMoves: ["e2e4", "d2d4", "g1f3"],
      solutionLine: [],
    });
    expect(() => parsePuzzleAnswers(start, "e4 e5", false)).toThrow("e5");
  });
  it("连续答案支持王车易位、吃子和升变", () => {
    expect(
      parsePuzzleAnswers(
        start,
        "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O",
        true,
      ).solutionLine.at(-1),
    ).toBe("e1g1");
    expect(
      parsePuzzleAnswers("7k/P7/8/8/8/8/8/7K w - - 0 1", "a8=N Kh7", true)
        .solutionLine,
    ).toEqual(["a7a8n", "h8h7"]);
  });
});

describe("连续解题", () => {
  it("正确首步后自动应手，最后一步之前不揭晓答案或允许评级", () => {
    const p = puzzle();
    const first = playPuzzleMove(p, null, "e2", "e4")!;
    expect(first.moves).toEqual(["e2e4", "e7e5"]);
    const board = new Chess();
    board.move("e4");
    board.move("e5");
    expect(first.fen).toBe(board.fen());
    expect(first.complete).toBe(false);
    const second = playPuzzleMove(p, first, "g1", "f3")!;
    expect(second.moves).toEqual(["e2e4", "e7e5", "g1f3", "b8c6"]);
    expect(second.complete).toBe(false);
    const last = playPuzzleMove(p, second, "f1", "b5")!;
    expect(last).toMatchObject({ correct: true, complete: true });
    expect(playPuzzleMove(p, last, "a7", "a6")).toBeNull();
  });
  it("合法但错误的后续步立即结束并记为错误", () => {
    const p = puzzle();
    const first = playPuzzleMove(p, null, "e2", "e4")!;
    const wrong = playPuzzleMove(p, first, "d2", "d4")!;
    expect(wrong).toMatchObject({ correct: false, complete: true });
    expect(wrong.moves).toEqual(["e2e4", "e7e5", "d2d4"]);
    expect(playPuzzleMove(p, first, "e2", "e4")).toBeNull();
    expect(first.moves).toEqual(["e2e4", "e7e5"]);
  });
  it("黑方题从来源局面开始；答案可在对手应手后结束", () => {
    const board = new Chess();
    board.move("e4");
    const p = puzzle("e5 Nf3 Nc6", board.fen());
    const first = playPuzzleMove(p, null, "e7", "e5")!;
    expect(first.moves).toEqual(["e7e5", "g1f3"]);
    expect(first.complete).toBe(false);
    expect(playPuzzleMove(p, first, "b8", "c6")).toMatchObject({
      correct: true,
      complete: true,
    });
    expect(playPuzzleMove(puzzle("e4 e5"), null, "e2", "e4")).toMatchObject({
      correct: true,
      complete: true,
    });
  });
  it("旧单步和自动题仍在第一步结束，自动题变化仅供参考", () => {
    const manual = {
      ...puzzle(),
      ...parsePuzzleAnswers(start, "e4,d4", false),
    };
    expect(isMultiMovePuzzle(manual)).toBe(false);
    expect(playPuzzleMove(manual, null, "d2", "d4")).toMatchObject({
      correct: true,
      complete: true,
      moves: ["d2d4"],
    });
    const auto = { ...puzzle(), sourceType: "auto" as const };
    expect(isMultiMovePuzzle(auto)).toBe(false);
    expect(playPuzzleMove(auto, null, "e2", "e4")).toMatchObject({
      correct: true,
      complete: true,
      moves: ["e2e4"],
    });
  });
  it("升变保留指定棋子，错误的损坏应手不会静默通过", () => {
    const p = puzzle("a8=N Kh7", "7k/P7/8/8/8/8/8/7K w - - 0 1");
    expect(playPuzzleMove(p, null, "a7", "a8", "n")).toMatchObject({
      correct: true,
      complete: true,
    });
    const broken = { ...puzzle(), solutionLine: ["e2e4", "e2e3", "g1f3"] };
    expect(() => playPuzzleMove(broken, null, "e2", "e4")).toThrow(
      "对手应手不合法",
    );
  });
});
