import { Box } from "@radix-ui/themes";
import type { EngineAnalysis } from "../../shared/api";
import { positionEvaluation } from "./evaluation";

export default function EvaluationBar({
  fen,
  analysis,
  flipped,
}: {
  fen: string;
  analysis: EngineAnalysis | null;
  flipped: boolean;
}) {
  const evaluation = positionEvaluation(fen, analysis);
  const whitePercent = evaluation?.whitePercent ?? 50;
  const whiteAtTop = flipped;
  const description = evaluation?.description ?? "当前局面暂无引擎评分";
  return (
    <Box
      className="relative w-3 shrink-0 overflow-hidden rounded-md border border-panel-edge"
      role="img"
      aria-label={`引擎评分：${description}`}
      title={`${description} · 正分为白方占优，负分为黑方占优`}
      data-evaluation-bar
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 12 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect width="12" height="100" className="fill-evaluation-black" />
        <rect
          width="12"
          y={whiteAtTop ? 0 : 100 - whitePercent}
          height={whitePercent}
          className="fill-evaluation-white"
        />
      </svg>
    </Box>
  );
}
