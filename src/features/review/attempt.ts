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

export function isWaitingForReply(attempt: PuzzleAttempt | null): boolean {
  return !!attempt && !attempt.complete && attempt.moves.length % 2 === 1;
}

export function playPuzzleMove(
  puzzle: Puzzle,
  previous: PuzzleAttempt | null,
  from: string,
  to: string,
  promotion = "q",
): PuzzleAttempt | null {
  if (previous?.complete || isWaitingForReply(previous)) return null;
  const played = tryMove(previous?.fen ?? puzzle.fen, from, to, promotion);
  if (!played) return null;
  const step = previous?.moves.length ?? 0;
  const multiMove = isMultiMovePuzzle(puzzle);
  const correct = multiMove
    ? played.uci === puzzle.solutionLine[step]
    : puzzle.expectedMoves.includes(played.uci);
  // Reject the move without advancing the board or the answer sequence.
  if (!correct) {
    return {
      fen: previous?.fen ?? puzzle.fen,
      moves: [...(previous?.moves ?? [])],
      san: played.san,
      correct: false,
      complete: false,
    };
  }
  const result: PuzzleAttempt = {
    fen: played.fen,
    moves: [...(previous?.moves ?? []), played.uci],
    san: played.san,
    correct,
    complete: !multiMove || !correct || step + 1 === puzzle.solutionLine.length,
  };
  // Validate the stored reply before accepting the player's move.
  if (!result.complete) playPuzzleReply(puzzle, result);
  return result;
}

export function playPuzzleReply(
  puzzle: Puzzle,
  previous: PuzzleAttempt,
): PuzzleAttempt | null {
  if (!isWaitingForReply(previous)) return null;
  const uci = puzzle.solutionLine[previous.moves.length];
  const reply = uci
    ? tryMove(previous.fen, uci.slice(0, 2), uci.slice(2, 4), uci[4])
    : null;
  if (!reply) throw new Error("题目的对手应手不合法，请在题库中编辑修正");
  const moves = [...previous.moves, reply.uci];
  return {
    ...previous,
    fen: reply.fen,
    moves,
    san: reply.san,
    complete: moves.length === puzzle.solutionLine.length,
  };
}

export function schedulePuzzleReply(
  puzzle: Puzzle,
  attempt: PuzzleAttempt,
  onReply: (reply: PuzzleAttempt) => void,
  onError: (message: string) => void,
): () => void {
  const timer = setTimeout(() => {
    try {
      const reply = playPuzzleReply(puzzle, attempt);
      if (reply) onReply(reply);
    } catch (error) {
      onError(String(error));
    }
  }, 400);
  return () => clearTimeout(timer);
}
