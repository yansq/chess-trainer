import { describe, expect, it } from "vitest";
import { Chess, DEFAULT_POSITION } from "chess.js";
import {
  placePiece,
  positionError,
  positionFen,
  positionFromFen,
} from "../src/features/puzzles/position";
import { parsePuzzleAnswers } from "../src/features/puzzles/answers";

describe("新题目初始局面", () => {
  it("导入与导出保留完整 FEN，包括走棋方、易位权和回合计数", () => {
    for (const fen of [
      DEFAULT_POSITION,
      "r3k2r/8/8/3pP3/8/8/8/R3K2R w KQkq d6 0 17",
      "4k3/8/8/8/8/8/8/4K3 b - - 13 42",
    ]) {
      expect(positionFen(positionFromFen(fen))).toBe(fen);
    }
  });
  it("允许编辑中的空棋盘，进入走法录入前要求合法双王和兵位置", () => {
    let draft = {
      ...positionFromFen(DEFAULT_POSITION),
      pieces: {},
      castling: "",
    };
    expect(positionError(positionFen(draft))).toContain("白王");
    draft = placePiece(draft, "e1", "wK");
    draft = placePiece(draft, "e8", "bK");
    expect(positionError(positionFen(draft))).toBe("");
    draft = placePiece(draft, "a8", "wP");
    expect(positionError(positionFen(draft))).toContain("兵");
  });
  it("移动或擦除王车会清理相应易位权，不改变原草稿", () => {
    const original = positionFromFen(DEFAULT_POSITION);
    const moved = placePiece(original, "h3", "wR", "h1");
    expect(moved.pieces.h1).toBeUndefined();
    expect(moved.pieces.h3.pieceType).toBe("wR");
    expect(moved.castling).toBe("Qkq");
    expect(original.castling).toBe("KQkq");
    expect(placePiece(original, "e1", null).castling).toBe("kq");
  });
  it("拒绝格式错误、重复王、相邻王和未轮到走棋的一方被将军", () => {
    for (const fen of [
      "bad",
      "8/8/8/8/8/8/8/8 w - - 0 1",
      "4k3/8/8/8/8/8/8/3KK3 w - - 0 1",
      "8/8/8/8/8/8/4k3/4K3 w - - 0 1",
      "4k3/8/8/8/8/8/8/K3R3 w - - 0 1",
    ]) {
      expect(positionError(fen)).not.toBe("");
      expect(() => positionFromFen(fen)).toThrow();
    }
    expect(positionError("4k3/8/8/8/8/8/8/K3R3 b - - 0 1")).toBe("");
  });
  it("易位与吃过路兵权利必须符合实际棋盘，摆子后清理旧吃过路兵权利", () => {
    expect(positionError("4k3/8/8/8/8/8/8/4K3 w K - 0 1")).toContain("易位");
    expect(positionError("4k3/8/8/4P3/8/8/8/4K3 w - d6 0 1")).toContain(
      "吃过路兵",
    );
    const ep = positionFromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    expect(
      parsePuzzleAnswers(positionFen(ep), "exd6 Kf7", true).solutionLine,
    ).toEqual(["e5d6", "e8f7"]);
    expect(placePiece(ep, "a1", "wR").enPassant).toBe("-");
  });
  it("黑方起始局面、少升变和易位均复用连续答案语义", () => {
    const black = new Chess();
    black.move("e4");
    expect(
      parsePuzzleAnswers(
        positionFen(positionFromFen(black.fen())),
        "e5 Nf3",
        true,
      ).solutionLine,
    ).toEqual(["e7e5", "g1f3"]);
    expect(
      parsePuzzleAnswers("7k/P7/8/8/8/8/8/7K w - - 0 1", "a8=N Kh7", true)
        .solutionLine,
    ).toEqual(["a7a8n", "h8h7"]);
    expect(
      parsePuzzleAnswers(
        "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",
        "O-O O-O-O",
        true,
      ).solutionLine,
    ).toEqual(["e1g1", "e8c8"]);
  });
});
