import { currentReviewMove, type ReviewTree } from "./review-tree";

// Follow node identities rather than ply/FEN: sibling branches can share a ply,
// and a repeated position must not accidentally become a new puzzle origin.
export function puzzleContinuation(
  tree: ReviewTree,
  originId: string | null,
): string | null {
  const moves: string[] = [];
  let currentId = tree.currentId;
  while (currentId !== originId) {
    if (currentId === null) return null;
    const move = currentReviewMove({ ...tree, currentId });
    if (!move) return null;
    moves.push(move.san);
    currentId = move.parentId;
  }
  return moves.reverse().join(" ");
}
