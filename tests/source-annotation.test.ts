import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { parsePgn } from "../src/features/games/pgn";
import { findSourceAnnotation } from "../src/features/review/source-annotation";
import type { Puzzle } from "../src/shared/types";

const game = { ...parsePgn("1. e4 e5 2. Nf3 *", "local"), isBot: false };
const annotations: [string | null, string][] = [
  [null, "对局总结"],
  [game.moves[0].id, "**控制中心**，再发展棋子。"],
  [game.moves[1].id, "注意黑方 e5 后的应对。"],
];
const puzzle: Puzzle = {
  id: "puzzle",
  category: "opening",
  sourceType: "manual",
  sourceGameId: game.id,
  sourceMoveId: game.moves[0].id,
  fen: game.moves[0].fenAfter,
  sideToMove: "black",
  title: "测试题",
  description: "",
  originalMove: null,
  expectedMoves: ["e7e5"],
  solutionLine: [],
  errorCategory: null,
};

describe("来源局面注释", () => {
  it("手动题显示当前局面的注释并保留原始文本", () => {
    expect(findSourceAnnotation(puzzle, game, annotations)).toBe(
      "**控制中心**，再发展棋子。",
    );
  });
  it("自动题按实际局面匹配，不把来源招法走完后的注释显示在走之前", () => {
    expect(
      findSourceAnnotation(
        {
          ...puzzle,
          sourceType: "auto",
          sourceMoveId: game.moves[1].id,
          fen: game.moves[1].fenBefore,
        },
        game,
        annotations,
      ),
    ).toBe("**控制中心**，再发展棋子。");
  });
  it("初始局面显示在该位置保存的对局总结", () => {
    expect(
      findSourceAnnotation(
        { ...puzzle, sourceMoveId: null, fen: game.moves[0].fenBefore },
        game,
        annotations,
      ),
    ).toBe("对局总结");
  });
  it("没有注释的局面不会错误显示其他招法的注释或总结", () => {
    expect(
      findSourceAnnotation(
        {
          ...puzzle,
          sourceMoveId: game.moves[2].id,
          fen: game.moves[2].fenAfter,
        },
        game,
        annotations,
      ),
    ).toBeNull();
    expect(
      findSourceAnnotation(puzzle, game, [[game.moves[0].id, "  \n "]]),
    ).toBeNull();
  });
  it("无来源、其他对局及临时分支不会误用主线注释", () => {
    expect(
      findSourceAnnotation(
        { ...puzzle, sourceGameId: null },
        game,
        annotations,
      ),
    ).toBeNull();
    expect(
      findSourceAnnotation(
        { ...puzzle, sourceGameId: "other-game" },
        game,
        annotations,
      ),
    ).toBeNull();
    const branch = new Chess();
    branch.move("d4");
    expect(
      findSourceAnnotation(
        { ...puzzle, sourceMoveId: null, fen: branch.fen() },
        game,
        annotations,
      ),
    ).toBeNull();
  });
});
