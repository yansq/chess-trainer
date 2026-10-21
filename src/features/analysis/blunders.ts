import type { Move } from "../../shared/types";
import type { EngineAnalysis } from "../../shared/api";
export type Category = "Inaccuracy" | "Mistake" | "Blunder";
export interface Candidate {
  move: Move;
  bestMove: string;
  solutionLine: string[];
  loss: number;
  category: Category;
}
function winChance(a: EngineAnalysis, side: "white" | "black"): number {
  const { scoreType, scoreValue } = a.variations[0];
  const whiteScore =
    scoreType === "mate"
      ? scoreValue === 0
        ? a.fen.split(" ")[1] === "w"
          ? -10000
          : 10000
        : scoreValue > 0
          ? 10000
          : -10000
      : scoreValue;
  const score = side === "white" ? whiteScore : -whiteScore;
  return 1 / (1 + Math.exp(-score / 150));
}
export function classifyMove(
  move: Move,
  side: "white" | "black",
  before: EngineAnalysis,
  after: EngineAnalysis,
  thresholds = { inaccuracy: 0.12, mistake: 0.25, blunder: 0.4 },
): Candidate | null {
  const loss = winChance(before, side) - winChance(after, side);
  const bestMove = before.variations[0].pv[0];
  if (!bestMove || bestMove === move.uci || loss < thresholds.inaccuracy)
    return null;
  return {
    move,
    bestMove,
    solutionLine: before.variations[0].pv,
    loss,
    category:
      loss >= thresholds.blunder
        ? "Blunder"
        : loss >= thresholds.mistake
          ? "Mistake"
          : "Inaccuracy",
  };
}

// Display ratings are separate from mistake candidates used to create puzzles.
// Small losses use the same evaluation model as the existing mistake ratings.
export function evaluateMoveQuality(
  move: Move,
  side: "white" | "black",
  before: EngineAnalysis,
  after: EngineAnalysis,
  thresholds = { inaccuracy: 0.12, mistake: 0.25, blunder: 0.4 },
): { candidate: Candidate | null; category: Category | "Good" | null } {
  if (
    before.fen !== move.fenBefore ||
    after.fen !== move.fenAfter ||
    !before.variations.length ||
    !after.variations.length ||
    !before.variations[0].pv.length
  )
    return { candidate: null, category: null };
  const candidate = classifyMove(move, side, before, after, thresholds);
  if (candidate) return { candidate, category: candidate.category };
  const bestMove = before.variations[0].pv[0];
  const loss = winChance(before, side) - winChance(after, side);
  return {
    candidate: null,
    category: bestMove === move.uci || loss <= 0.05 ? "Good" : null,
  };
}
