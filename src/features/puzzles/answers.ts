import { normalizeAnswer, normalizeAnswerLine } from "../../shared/chess/moves";
import type { Puzzle } from "../../shared/types";

// Existing manual puzzles have no solution line; engine-generated lines remain
// reference variations rather than a required sequence of training moves.
export function isMultiMovePuzzle(puzzle: Puzzle) {
  return puzzle.sourceType === "manual" && puzzle.solutionLine.length > 1;
}

export function parsePuzzleAnswers(
  fen: string,
  text: string,
  multiMove: boolean,
) {
  const tokens = text.split(/[,，\s]+/).filter(Boolean);
  if (!tokens.length) throw new Error("请输入合法的 SAN 或 UCI 答案");
  if (multiMove) {
    const solutionLine = normalizeAnswerLine(fen, tokens);
    return { expectedMoves: [solutionLine[0]], solutionLine };
  }
  const expectedMoves = tokens.map((answer) => {
    const move = normalizeAnswer(fen, answer);
    if (!move) throw new Error(`「${answer}」在当前局面不合法`);
    return move;
  });
  return { expectedMoves, solutionLine: [] as string[] };
}
