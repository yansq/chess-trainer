import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { Puzzle } from "../src/shared/types";
import {
  preparePuzzleUpdate,
  puzzleAnswerText,
  puzzlePreview,
} from "../src/features/puzzles/editor";
const puzzle: Puzzle = {
  id: "test",
  category: "opening",
  sourceType: "manual",
  sourceGameId: null,
  sourceMoveId: null,
  fen: new Chess().fen(),
  sideToMove: "white",
  title: "测试",
  description: "",
  originalMove: null,
  expectedMoves: ["e2e4"],
  solutionLine: [],
  errorCategory: null,
};
describe("题目编辑与预览", () => {
  it("原单步手动题可编辑为连续多步，预览与保存答案一致", () => {
    const updated = preparePuzzleUpdate(puzzle, "e4 e5 Nf3");
    expect(updated.expectedMoves).toEqual(["e2e4"]);
    expect(updated.solutionLine).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(puzzleAnswerText(updated)).toBe("e4 e5 Nf3");
    const preview = puzzlePreview(puzzle, "e4 e5 Nf3", 0);
    const chess = new Chess();
    for (const move of ["e4", "e5", "Nf3"]) chess.move(move);
    expect(preview.positions.at(-1)).toBe(chess.fen());
    expect(preview.positions).toHaveLength(4);
    expect(preview.sans).toEqual(["e4", "e5", "Nf3"]);
  });
  it("旧题的多个独立答案保持语义，可分别预览", () => {
    const legacy = { ...puzzle, expectedMoves: ["e2e4", "d2d4"] };
    expect(puzzleAnswerText(legacy)).toBe("e4, d4");
    expect(preparePuzzleUpdate(legacy, "e4, Nf3").solutionLine).toEqual([]);
    const preview = puzzlePreview(legacy, "e4, Nf3", 1);
    expect(preview.alternatives).toEqual(["e4", "Nf3"]);
    expect(preview.sans).toEqual(["Nf3"]);
    expect(new Chess(preview.positions[1]).get("f3")?.type).toBe("n");
  });
  it("自动题保存答案时保留引擎参考线，但棋盘预览编辑后的正确招法", () => {
    const auto = {
      ...puzzle,
      sourceType: "auto" as const,
      solutionLine: ["e2e4", "e7e5"],
    };
    expect(preparePuzzleUpdate(auto, "d4").solutionLine).toEqual(
      auto.solutionLine,
    );
    expect(preparePuzzleUpdate(auto, "d4").expectedMoves).toEqual(["d2d4"]);
    expect(puzzlePreview(auto, "d4", 0).sans).toEqual(["d4"]);
  });
  it("非法或空答案不能保存或预览", () => {
    expect(() => preparePuzzleUpdate(puzzle, "")).toThrow();
    expect(() => puzzlePreview(puzzle, "e4 e4", 0)).toThrow("第 2 步");
  });
});
