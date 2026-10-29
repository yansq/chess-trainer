import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { parsePgn } from "../src/features/games/pgn";
import {
  createReviewTree,
  deleteReviewBranch,
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

describe("恢复已保存的分支", () => {
  it("恢复稳定节点、嵌套分支和主线，并复用已有走法", () => {
    const original = sample();
    const fork = selectReviewMove(original, original.moves[2].id);
    const first = playReviewMove(fork, "g8", "f6")!;
    const continuation = playReviewMove(first, "f1", "b5")!;
    const nested = playReviewMove(
      navigateReview(continuation, "back"),
      "f1",
      "c4",
    )!;
    const variations = JSON.parse(
      JSON.stringify(nested.moves.filter((m) => m.sourceMoveId === null)),
    );
    const restored = createReviewTree(
      parsePgn("1. e4 e5 2. Nf3 Nc6 *", "local").moves,
      variations,
    );
    expect(restored.currentId).toBeNull();
    expect(restored.moves).toHaveLength(nested.moves.length);
    expect(restored.moves.filter((m) => m.sourceMoveId !== null)).toHaveLength(
      4,
    );
    const selected = selectReviewMove(restored, continuation.currentId);
    expect(currentReviewMove(selected)?.san).toBe("Bb5");
    expect(navigateReview(selected, "back").currentId).toBe(first.currentId);
    const repeated = playReviewMove(
      selectReviewMove(restored, original.moves[2].id),
      "g8",
      "f6",
    )!;
    expect(repeated.currentId).toBe(first.currentId);
    expect(repeated.moves).toHaveLength(restored.moves.length);
    expect(currentReviewMove(returnToMainline(selected))?.san).toBe("Nc6");
    expect(
      currentReviewMove(selectReviewMove(restored, nested.currentId))?.san,
    ).toBe("Bc4");
  });
});

describe("删除复盘分支", () => {
  function branched() {
    const base = sample();
    const first = playReviewMove(
      selectReviewMove(base, base.moves[2].id),
      "g8",
      "f6",
    )!;
    const child = playReviewMove(first, "f1", "b5")!;
    const nested = playReviewMove(child, "b8", "c6")!;
    const sibling = playReviewMove(
      selectReviewMove(nested, first.currentId),
      "f1",
      "c4",
    )!;
    return { base, first, child, nested, sibling };
  }
  it("删除子分支及其后续变化，当前局面退回父节点，保留相邻分支", () => {
    const { first, child, nested, sibling } = branched();
    const selected = selectReviewMove(sibling, nested.currentId);
    const result = deleteReviewBranch(
      { ...selected, moves: [...selected.moves].reverse() },
      child.currentId!,
    );
    expect(
      result.moves.some(
        (m) => m.id === child.currentId || m.id === nested.currentId,
      ),
    ).toBe(false);
    expect(result.moves.some((m) => m.id === sibling.currentId)).toBe(true);
    expect(result.currentId).toBe(first.currentId);
    expect(navigateReview(result, "next").currentId).toBe(sibling.currentId);
    expect(Object.values(result.preferred)).not.toContain(child.currentId);
  });
  it("删除整条分支时保留主线；删除非当前分支不改变棋盘", () => {
    const { base, first, sibling } = branched();
    const tree = selectReviewMove(sibling, base.moves[3].id);
    const result = deleteReviewBranch(tree, first.currentId!);
    expect(result.moves).toEqual(base.moves);
    expect(result.currentId).toBe(base.moves[3].id);
    expect(deleteReviewBranch(tree, base.moves[0].id)).toBe(tree);
    expect(deleteReviewBranch(tree, "missing")).toBe(tree);
  });
  it("删除从初始局面开始的分支后退回初始局面", () => {
    const base = sample();
    const root = playReviewMove(base, "d2", "d4")!;
    const selected = playReviewMove(root, "d7", "d5")!;
    const result = deleteReviewBranch(selected, root.currentId!);
    expect(result.currentId).toBeNull();
    expect(result.moves).toEqual(base.moves);
    expect(navigateReview(result, "next").currentId).toBe(base.moves[0].id);
  });
});
