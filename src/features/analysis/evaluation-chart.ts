import type { Move } from "../../shared/types";
import type { EngineAnalysis } from "../../shared/api";
import { positionEvaluation } from "./evaluation";

export function evaluationChartPoints(
  moves: Move[],
  initialFen: string,
  positions: Record<string, EngineAnalysis>,
) {
  return [
    { id: null, fen: initialFen, label: "初始局面" },
    ...moves.map((move) => ({
      id: move.id,
      fen: move.fenAfter,
      label: `${move.fenBefore.split(" ")[5]}${move.fenBefore.split(" ")[1] === "w" ? "." : "…"} ${move.san}`,
    })),
  ].map((point, index) => {
    const evaluation = positionEvaluation(
      point.fen,
      positions[point.fen] ?? null,
    );
    return {
      ...point,
      x: moves.length ? (index / moves.length) * 1000 : 500,
      y: evaluation ? 100 - evaluation.whitePercent : null,
      evaluation,
    };
  });
}

// Missing scores break the line; they must never look like an equal position.
export function evaluationChartPath(
  points: ReturnType<typeof evaluationChartPoints>,
) {
  let connected = false;
  return points
    .map((point) => {
      if (point.y === null) {
        connected = false;
        return "";
      }
      const command = connected ? "L" : "M";
      connected = true;
      return `${command}${point.x},${point.y}`;
    })
    .join(" ");
}
