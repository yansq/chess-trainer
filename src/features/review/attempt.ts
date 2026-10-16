import { tryMove } from "../../shared/chess/moves";
import type { Puzzle } from "../../shared/types";
import { isMultiMovePuzzle } from "../puzzles/answers";

export interface PuzzleAttempt {
  fen: string;
  moves: string[];
  san: string;
  complete: boolean;
  correct: boolean;
}

export function playPuzzleMove(
  puzzle: Puzzle,
  previous: PuzzleAttempt | null,
  from: string,
  to: string,
  promotion = "q",
): PuzzleAttempt | null {
  if (previous?.complete) return null;
  const played = tryMove(previous?.fen ?? puzzle.fen, from, to, promotion);
  if (!played) return null;
  const step = previous?.moves.length ?? 0;
  const multiMove = isMultiMovePuzzle(puzzle);
  const correct = multiMove
    ? played.uci === puzzle.solutionLine[step]
    : puzzle.expectedMoves.includes(played.uci);
  const result: PuzzleAttempt = {
    fen: played.fen,
    moves: [...(previous?.moves ?? []), played.uci],
    san: played.san,
    correct,
    complete: !multiMove || !correct || step + 1 === puzzle.solutionLine.length,
  };
  if (!result.complete) {
    const uci = puzzle.solutionLine[step + 1];
    const reply = tryMove(result.fen, uci.slice(0, 2), uci.slice(2, 4), uci[4]);
    if (!reply) throw new Error("题目的对手应手不合法，请在题库中编辑修正");
    result.fen = reply.fen;
    result.moves.push(reply.uci);
    result.complete = result.moves.length === puzzle.solutionLine.length;
  }
  return result;
}
