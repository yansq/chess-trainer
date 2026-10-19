import { api, type EngineAnalysis } from "../../shared/api";
import type { Move } from "../../shared/types";
import { classifyMove, type Candidate } from "./blunders";

export const qualityBadges = {
  Inaccuracy: {
    symbol: "?!",
    label: "不精确",
    color: "bg-yellow-400 text-yellow-950",
  },
  Mistake: { symbol: "?", label: "错误", color: "bg-orange-500 text-white" },
  Blunder: { symbol: "??", label: "严重失误", color: "bg-red-600 text-white" },
} as const;

export interface MoveQuality {
  moveId: string;
  fen: string;
  candidate: Candidate | null;
  status: string;
}

// Reuse the completed current-position analysis, then evaluate the position
// before the move. Each request owns its cancellation and ignores late results.
export function startMoveQualityAnalysis(
  move: Move,
  after: EngineAnalysis,
  onChange: (quality: MoveQuality) => void,
  engineApi: Pick<
    typeof api,
    "getSetting" | "engineAnalyze" | "engineStop"
  > = api,
) {
  let active = true;
  let pending = false;
  const requestId = crypto.randomUUID();
  const report = (candidate: Candidate | null, status: string) => {
    if (active)
      onChange({ moveId: move.id, fen: move.fenAfter, candidate, status });
  };
  report(null, "评估招法…");
  void (async () => {
    try {
      const [path, depth, inaccuracy, mistake, blunder] = await Promise.all(
        [
          "engine_path",
          "engine_depth",
          "loss_inaccuracy",
          "loss_mistake",
          "loss_blunder",
        ].map((key) => engineApi.getSetting(key)),
      );
      if (!active) return;
      if (!path || after.fen !== move.fenAfter) {
        report(null, "");
        return;
      }
      pending = true;
      const before = await engineApi.engineAnalyze(
        path,
        move.fenBefore,
        Number(depth ?? 14),
        requestId,
      );
      pending = false;
      if (!active) return;
      if (
        before.fen !== move.fenBefore ||
        !before.variations.length ||
        !after.variations.length
      ) {
        report(null, "招法评估未返回有效结果");
        return;
      }
      const side = move.fenBefore.split(" ")[1] === "w" ? "white" : "black";
      report(
        classifyMove(move, side, before, after, {
          inaccuracy: Number(inaccuracy ?? 0.12),
          mistake: Number(mistake ?? 0.25),
          blunder: Number(blunder ?? 0.4),
        }),
        "",
      );
    } catch (error) {
      pending = false;
      report(null, `招法评估失败：${String(error)}`);
    }
  })();
  return () => {
    active = false;
    if (pending) void engineApi.engineStop(requestId).catch(() => {});
  };
}
