import { Chess } from "chess.js";
import type { Move } from "../../shared/types";
import { tryMove } from "../../shared/chess/moves";

export interface ReviewMove extends Omit<Move, "gameId"> {
  parentId: string | null;
  sourceMoveId: string | null;
}
export interface ReviewTree {
  initialFen: string;
  moves: ReviewMove[];
  currentId: string | null;
  preferred: Record<string, string>;
}

export function createReviewTree(moves: Move[]): ReviewTree {
  return {
    initialFen: moves[0]?.fenBefore ?? new Chess().fen(),
    moves: moves.map((move, index) => ({
      ...move,
      parentId: moves[index - 1]?.id ?? null,
      sourceMoveId: move.id,
    })),
    currentId: null,
    preferred: {},
  };
}

export function currentReviewMove(tree: ReviewTree): ReviewMove | null {
  return tree.moves.find((move) => move.id === tree.currentId) ?? null;
}

export function selectReviewMove(
  tree: ReviewTree,
  id: string | null,
): ReviewTree {
  if (id === null) return { ...tree, currentId: null };
  let move = tree.moves.find((node) => node.id === id);
  if (!move) return tree;
  const preferred = { ...tree.preferred };
  while (move) {
    preferred[move.parentId ?? "root"] = move.id;
    move = tree.moves.find((node) => node.id === move?.parentId);
  }
  return { ...tree, currentId: id, preferred };
}

function nextMove(tree: ReviewTree, id: string | null) {
  const children = tree.moves.filter((move) => move.parentId === id);
  return (
    children.find((move) => move.id === tree.preferred[id ?? "root"]) ??
    children[0]
  );
}

export function reviewLineEnd(tree: ReviewTree): ReviewMove | null {
  let move = currentReviewMove(tree);
  let next = nextMove(tree, tree.currentId);
  while (next) {
    move = next;
    next = nextMove(tree, move.id);
  }
  return move;
}

export function navigateReview(
  tree: ReviewTree,
  direction: "start" | "back" | "next" | "end",
): ReviewTree {
  if (direction === "start") return selectReviewMove(tree, null);
  if (direction === "back")
    return selectReviewMove(tree, currentReviewMove(tree)?.parentId ?? null);
  const move =
    direction === "end" ? reviewLineEnd(tree) : nextMove(tree, tree.currentId);
  return move ? selectReviewMove(tree, move.id) : tree;
}

export function returnToMainline(tree: ReviewTree): ReviewTree {
  const ply = currentReviewMove(tree)?.ply ?? 0;
  const mainline = tree.moves.filter((move) => move.sourceMoveId !== null);
  return {
    ...tree,
    preferred: {},
    currentId: mainline[Math.min(ply, mainline.length) - 1]?.id ?? null,
  };
}

export function playReviewMove(
  tree: ReviewTree,
  from: string,
  to: string,
  promotion = "q",
): ReviewTree | null {
  const current = currentReviewMove(tree);
  const fen = current?.fenAfter ?? tree.initialFen;
  const played = tryMove(fen, from, to, promotion);
  if (!played) return null;
  const existing = tree.moves.find(
    (move) => move.parentId === tree.currentId && move.uci === played.uci,
  );
  if (existing) return selectReviewMove(tree, existing.id);
  const move: ReviewMove = {
    id: `variation:${crypto.randomUUID()}`,
    parentId: tree.currentId,
    sourceMoveId: null,
    ply: (current?.ply ?? 0) + 1,
    san: played.san,
    uci: played.uci,
    fenBefore: fen,
    fenAfter: played.fen,
  };
  return selectReviewMove({ ...tree, moves: [...tree.moves, move] }, move.id);
}

export function moveNumber(move: ReviewMove): string {
  const [, side, , , , fullmove] = move.fenBefore.split(" ");
  return `${fullmove}${side === "w" ? "." : "…"}`;
}
