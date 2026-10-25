import { getEngineDepth } from "./engine-settings";
import { api, type EngineAnalysis } from "../../shared/api";
import type { Move } from "../../shared/types";
import { evaluateMoveQuality, type Candidate, type Category } from "./blunders";

export const qualityBadges = {
  Good: {
    symbol: "✓",
    label: "好棋",
    color: "bg-quality-good text-quality-ink",
  },
  Inaccuracy: {
    symbol: "?!",
    label: "不精确",
    color: "bg-quality-inaccuracy text-quality-inaccuracy-ink",
  },
  Mistake: {
    symbol: "?",
    label: "错误",
    color: "bg-quality-mistake text-quality-ink",
  },
  Blunder: {
    symbol: "??",
    label: "严重失误",
    color: "bg-quality-blunder text-quality-ink",
  },
} as const;

export interface MoveQuality {
  moveId: string;
  fen: string;
  candidate: Candidate | null;
  category: Category | "Good" | null;
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
  const report = (
    rating: Pick<MoveQuality, "candidate" | "category"> | null,
    status: string,
  ) => {
    if (active)
      onChange({
        moveId: move.id,
        fen: move.fenAfter,
        candidate: rating?.candidate ?? null,
        category: rating?.category ?? null,
        status,
      });
  };
  report(null, "评估招法…");
  void (async () => {
    try {
      const [path, depth, inaccuracy, mistake, blunder] = await Promise.all([
        engineApi.getSetting("engine_path"),
        getEngineDepth("position", engineApi),
        engineApi.getSetting("loss_inaccuracy"),
        engineApi.getSetting("loss_mistake"),
        engineApi.getSetting("loss_blunder"),
      ]);
      if (!active) return;
      if (!path || after.fen !== move.fenAfter) {
        report(null, "");
        return;
      }
      pending = true;
      const before = await engineApi.engineAnalyze(
        path,
        move.fenBefore,
        depth,
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
        evaluateMoveQuality(move, side, before, after, {
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
