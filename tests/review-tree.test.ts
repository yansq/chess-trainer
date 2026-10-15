import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { parsePgn } from "../src/features/games/pgn";
import {
  createReviewTree,
  currentReviewMove,
  moveNumber,
  navigateReview,
  playReviewMove,
  returnToMainline,
  selectReviewMove,
} from "../src/features/analysis/review-tree";

function sample() {
  return createReviewTree(parsePgn("1. e4 e5 2. Nf3 Nc6 *", "local").moves);
}

describe("复盘试走分支", () => {
  it("用 Nf6 创建分支并保留原对局的 Nc6", () => {
    const original = sample();
    const before = selectReviewMove(original, original.moves[2].id);
    const branch = playReviewMove(before, "g8", "f6")!;
    const move = currentReviewMove(branch)!;
    const expected = new Chess(before.moves[2].fenAfter);
    expected.move("Nf6");
    expect(move.san).toBe("Nf6");
    expect(move.ply).toBe(4);
    expect(move.parentId).toBe(original.moves[2].id);
    expect(move.sourceMoveId).toBeNull();
    expect(move.fenAfter).toBe(expected.fen());
    expect(branch.moves[3].san).toBe("Nc6");
    expect(original.moves).toHaveLength(4);
  });

  it("走出已有招法直接进入原节点，不重复创建", () => {
    const tree = sample();
    const start = playReviewMove(tree, "e2", "e4")!;
    expect(start.currentId).toBe(tree.moves[0].id);
    expect(start.moves).toHaveLength(4);
    const fork = selectReviewMove(tree, tree.moves[2].id);
    const branch = playReviewMove(fork, "g8", "f6")!;
    const repeated = playReviewMove(
      navigateReview(branch, "back"),
      "g8",
      "f6",
    )!;
    expect(repeated.currentId).toBe(branch.currentId);
    expect(repeated.moves).toHaveLength(5);
  });

  it("分支可继续走棋、创建其他变化并独立前进后退", () => {
    const tree = sample();
    const fork = selectReviewMove(tree, tree.moves[2].id);
    const branch = playReviewMove(fork, "g8", "f6")!;
    const first = playReviewMove(branch, "f1", "b5")!;
    const second = playReviewMove(navigateReview(first, "back"), "f1", "c4")!;
    expect(currentReviewMove(first)?.san).toBe("Bb5");
    expect(currentReviewMove(second)?.san).toBe("Bc4");
    expect(second.moves).toHaveLength(7);
    expect(
      navigateReview(navigateReview(second, "back"), "next").currentId,
    ).toBe(second.currentId);
    const chosen = selectReviewMove(second, first.currentId);
    expect(
      navigateReview(navigateReview(chosen, "start"), "end").currentId,
    ).toBe(first.currentId);
    expect(navigateReview(chosen, "next").currentId).toBe(first.currentId);
  });

  it("返回主线恢复原局面，后退再前进仍沿原对局", () => {
    const tree = sample();
    const branch = playReviewMove(
      selectReviewMove(tree, tree.moves[2].id),
      "g8",
      "f6",
    )!;
    const returned = returnToMainline(branch);
    expect(currentReviewMove(returned)?.san).toBe("Nc6");
    expect(
      navigateReview(navigateReview(returned, "back"), "next").currentId,
    ).toBe(tree.moves[3].id);
    expect(returned.moves).toHaveLength(5);
  });

  it("非法走法不会改变棋盘或分支", () => {
    const tree = sample();
    expect(playReviewMove(tree, "e7", "e5")).toBeNull();
    expect(playReviewMove(tree, "e2", "e5")).toBeNull();
    expect(tree.currentId).toBeNull();
    expect(tree.moves).toHaveLength(4);
  });

  it("支持自定义起始局面的黑方回合编号", () => {
    const game = parsePgn(
      '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5"]\n\n5... e5 *',
      "local",
    );
    const tree = createReviewTree(game.moves);
    expect(moveNumber(tree.moves[0])).toBe("5…");
    const branch = playReviewMove(tree, "c7", "c5")!;
    expect(moveNumber(currentReviewMove(branch)!)).toBe("5…");
  });

  it("支持按选择升变，使用标准记号并保留升变类型", () => {
    const tree = {
      ...createReviewTree([]),
      initialFen: "7k/P7/8/8/8/8/8/7K w - - 0 1",
    };
    const branch = playReviewMove(tree, "a7", "a8", "n")!;
    expect(currentReviewMove(branch)?.san).toBe("a8=N");
    expect(currentReviewMove(branch)?.uci).toBe("a7a8n");
  });
});
