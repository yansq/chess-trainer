import { Chess } from "chess.js";
import type { Puzzle } from "../../shared/types";
import { uciLineToSan } from "../../shared/chess/moves";
import { isMultiMovePuzzle, parsePuzzleAnswers } from "./answers";

// Preserve legacy puzzles with several acceptable first moves. Other manual
// puzzles default to a sequence, including those originally saved as one move.
export function usesAnswerSequence(puzzle: Puzzle) {
  return (
    puzzle.sourceType === "manual" &&
    (isMultiMovePuzzle(puzzle) || puzzle.expectedMoves.length <= 1)
  );
}
export function puzzleAnswerText(puzzle: Puzzle) {
  return isMultiMovePuzzle(puzzle)
    ? uciLineToSan(puzzle.fen, puzzle.solutionLine).join(" ")
    : puzzle.expectedMoves
        .map((uci) => uciLineToSan(puzzle.fen, [uci])[0] ?? uci)
        .join(", ");
}
export function preparePuzzleUpdate(puzzle: Puzzle, answers: string): Puzzle {
  const parsed = parsePuzzleAnswers(
    puzzle.fen,
    answers,
    usesAnswerSequence(puzzle),
  );
  return {
    ...puzzle,
    ...parsed,
    solutionLine:
      puzzle.sourceType === "auto" ? puzzle.solutionLine : parsed.solutionLine,
  };
}
export function puzzlePreview(
  puzzle: Puzzle,
  answers: string,
  alternative: number,
) {
  const updated = preparePuzzleUpdate(puzzle, answers);
  const sequence = usesAnswerSequence(puzzle);
  const line = sequence
    ? updated.solutionLine
    : [updated.expectedMoves[alternative] ?? updated.expectedMoves[0]];
  const chess = new Chess(puzzle.fen);
  const positions = [chess.fen()];
  const sans = line.map((uci) => {
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    positions.push(chess.fen());
    return move.san;
  });
  return {
    positions,
    sans,
    alternatives: sequence
      ? []
      : updated.expectedMoves.map((uci) => uciLineToSan(puzzle.fen, [uci])[0]),
  };
}
