import { getEngineDepth } from "./engine-settings";
import { Chess } from "chess.js";
import { api, type EngineAnalysis } from "../../shared/api";
import type { Move } from "../../shared/types";
import { evaluateMoveQuality } from "./blunders";
import type { MoveQuality } from "./move-quality";

export interface GameAnalysis {
  positions: Record<string, EngineAnalysis>;
  qualities: Record<string, MoveQuality>;
  completed: number;
  total: number;
  status: string;
  failed: boolean;
}

// A single sequential producer owns mainline work. Navigation never restarts it.
// Each shared position is searched once; the backend also persists engine cache.
export function startGameAnalysis(
  moves: Move[],
  initialFen: string,
  onChange: (state: GameAnalysis) => void,
  engineApi: Pick<
    typeof api,
    "getSetting" | "engineAnalyze" | "engineStop"
  > = api,
) {
  let active = true;
  let requestId: string | null = null;
  let state: GameAnalysis = {
    positions: {},
    qualities: {},
    completed: 0,
    total: moves.length,
    status: `整局预分析 0 / ${moves.length}`,
    failed: false,
  };
  const report = (patch: Partial<GameAnalysis> = {}) => {
    state = { ...state, ...patch };
    if (active) onChange(state);
  };
  report();
  void (async () => {
    try {
      const [path, depth, inaccuracy, mistake, blunder] = await Promise.all([
        engineApi.getSetting("engine_path"),
        getEngineDepth("preanalysis", engineApi),
        engineApi.getSetting("loss_inaccuracy"),
        engineApi.getSetting("loss_mistake"),
        engineApi.getSetting("loss_blunder"),
      ]);
      if (!active) return;
      if (!path) {
        report({ status: "请在设置中配置 Stockfish 路径" });
        return;
      }
      const thresholds = {
        inaccuracy: Number(inaccuracy ?? 0.12),
        mistake: Number(mistake ?? 0.25),
        blunder: Number(blunder ?? 0.4),
      };
      async function analyze(fen: string) {
        if (state.positions[fen]) return state.positions[fen];
        if (!active) throw new Error("已取消");
        const chess = new Chess(fen);
        // Terminal positions have a known result and no engine PV to return.
        if (chess.isGameOver()) {
          const result: EngineAnalysis = {
            fen,
            variations: [
              {
                rank: 1,
                depth: Number(depth),
                scoreType: chess.isCheckmate() ? "mate" : "cp",
                scoreValue: 0,
                pv: [],
              },
            ],
          };
          report({ positions: { ...state.positions, [fen]: result } });
          return result;
        }
        requestId = crypto.randomUUID();
        const result = await engineApi.engineAnalyze(
          path!,
          fen,
          Number(depth),
          requestId,
          undefined,
          1,
        );
        requestId = null;
        if (!active) throw new Error("已取消");
        if (result.fen !== fen || !result.variations.length)
          throw new Error("引擎未返回有效局面评价");
        report({ positions: { ...state.positions, [fen]: result } });
        return result;
      }
      await analyze(initialFen);
      for (const move of moves) {
        if (!active) return;
        const before = await analyze(move.fenBefore);
        const after = await analyze(move.fenAfter);
        if (!active) return;
        const side = move.fenBefore.split(" ")[1] === "w" ? "white" : "black";
        const completed = state.completed + 1;
        report({
          qualities: {
            ...state.qualities,
            [move.id]: {
              moveId: move.id,
              fen: move.fenAfter,
              ...evaluateMoveQuality(move, side, before, after, thresholds),
              status: "",
            },
          },
          completed,
          status: `整局预分析 ${completed} / ${moves.length}`,
        });
      }
      report({ status: `整局分析完成 ${moves.length} / ${moves.length}` });
    } catch (error) {
      requestId = null;
      if (active)
        report({ status: `整局分析失败：${String(error)}`, failed: true });
    }
  })();
  return () => {
    active = false;
    if (requestId) void engineApi.engineStop(requestId).catch(() => {});
  };
}
