import type { Move } from "../../shared/types";
import type { EngineAnalysis } from "../../shared/api";
export type Category = "Inaccuracy" | "Mistake" | "Blunder";
export interface Candidate {
  move: Move;
  before: EngineAnalysis;
  after: EngineAnalysis;
  loss: number;
  category: Category;
}
function winChance(a: EngineAnalysis, side: "white" | "black"): number {
  const whiteScore =
    a.scoreType === "mate"
      ? a.scoreValue === 0
        ? a.fen.split(" ")[1] === "w"
          ? -10000
          : 10000
        : a.scoreValue > 0
          ? 10000
          : -10000
      : a.scoreValue;
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
  if (
    !before.bestMove ||
    before.bestMove === move.uci ||
    loss < thresholds.inaccuracy
  )
    return null;
  return {
    move,
    before,
    after,
    loss,
    category:
      loss >= thresholds.blunder
        ? "Blunder"
        : loss >= thresholds.mistake
          ? "Mistake"
          : "Inaccuracy",
  };
}
