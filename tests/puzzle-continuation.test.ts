import { describe, expect, it } from "vitest";
import { parsePgn } from "../src/features/games/pgn";
import {
  createReviewTree,
  playReviewMove,
  selectReviewMove,
  navigateReview,
} from "../src/features/analysis/review-tree";
import { puzzleContinuation } from "../src/features/analysis/puzzle-continuation";
const sample = () =>
  createReviewTree(parsePgn("1. e4 e5 2. Nf3 Nc6 *", "local").moves);
describe("从固定出题起点记录后续招法", () => {
  it("顺序记录双方招法，包括原棋谱中已存在的招法", () => {
    let tree = sample();
    tree = playReviewMove(tree, "e2", "e4")!;
    tree = playReviewMove(tree, "e7", "e5")!;
    tree = playReviewMove(tree, "g1", "f3")!;
    expect(puzzleContinuation(tree, null)).toBe("e4 e5 Nf3");
  });
  it("黑方局面开题时只记录起点之后的走法", () => {
    let tree = sample();
    const origin = tree.moves[0].id;
    tree = selectReviewMove(tree, origin);
    tree = playReviewMove(tree, "c7", "c5")!;
    tree = playReviewMove(tree, "g1", "f3")!;
    expect(puzzleContinuation(tree, origin)).toBe("c5 Nf3");
  });
  it("退回缩短答案，分支改走替换旧招法而非继续拼接", () => {
    let tree = sample();
    tree = playReviewMove(tree, "e2", "e4")!;
    tree = playReviewMove(tree, "e7", "e5")!;
    tree = navigateReview(tree, "back");
    expect(puzzleContinuation(tree, null)).toBe("e4");
    tree = playReviewMove(tree, "c7", "c5")!;
    expect(puzzleContinuation(tree, null)).toBe("e4 c5");
    tree = navigateReview(navigateReview(tree, "back"), "back");
    expect(puzzleContinuation(tree, null)).toBe("");
  });
  it("不把起点前或其他分支的局面混入答案", () => {
    const tree = sample();
    const origin = tree.moves[1].id;
    expect(
      puzzleContinuation(selectReviewMove(tree, tree.moves[0].id), origin),
    ).toBeNull();
    const sibling = playReviewMove(
      selectReviewMove(tree, tree.moves[0].id),
      "c7",
      "c5",
    )!;
    expect(puzzleContinuation(sibling, origin)).toBeNull();
    expect(puzzleContinuation(selectReviewMove(tree, origin), origin)).toBe("");
  });
  it("升变记录实际选择的棋子与SAN", () => {
    const tree = createReviewTree(
      parsePgn(
        '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n1. a8=Q+ *',
        "local",
      ).moves,
    );
    const promoted = playReviewMove(tree, "a7", "a8", "n")!;
    expect(puzzleContinuation(promoted, null)).toBe("a8=N");
  });
});
