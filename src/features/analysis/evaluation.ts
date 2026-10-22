import type { EngineAnalysis } from "../../shared/api";

// Engine scores are already normalized to White's perspective by the backend.
export function positionEvaluation(
  fen: string,
  analysis: EngineAnalysis | null,
) {
  const score = analysis?.fen === fen ? analysis.variations[0] : null;
  if (!score || !Number.isFinite(score.scoreValue)) return null;
  const value = score.scoreValue;
  if (score.scoreType === "mate") {
    const whiteWins = value === 0 ? fen.split(" ")[1] === "b" : value > 0;
    return {
      whitePercent: whiteWins ? 100 : 0,
      label:
        value === 0
          ? whiteWins
            ? "1–0"
            : "0–1"
          : `${value < 0 ? "−" : ""}M${Math.abs(value)}`,
      description:
        value === 0
          ? `${whiteWins ? "白方" : "黑方"}获胜（将死）`
          : `${whiteWins ? "白方" : "黑方"}将杀，${Math.abs(value)}步`,
      whiteFavored: whiteWins,
    };
  }
  return {
    // A bounded visual scale, not an asserted win probability.
    whitePercent: Math.max(2, Math.min(98, 50 + 50 * Math.tanh(value / 400))),
    label: `${value > 0 ? "+" : value < 0 ? "−" : ""}${(Math.abs(value) / 100).toFixed(Math.abs(value) >= 1000 ? 0 : 1)}`,
    description:
      value === 0
        ? "局面均衡"
        : `${value > 0 ? "白方" : "黑方"}占优，${(Math.abs(value) / 100).toFixed(2)}兵`,
    whiteFavored: value >= 0,
  };
}
