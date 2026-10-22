import { getEngineDepth } from "./engine-settings";
import { Chess, validateFen } from "chess.js";
import { api, type EngineAnalysis } from "../../shared/api";

export interface PositionAnalysis {
  fen: string;
  analysis: EngineAnalysis | null;
  status: string;
}

// Separate each request's lifetime from the page so late updates cannot replace
// the current position, including when navigating A → B → A.
export function startPositionAnalysis(
  fen: string,
  onChange: (state: PositionAnalysis) => void,
  engineApi: Pick<
    typeof api,
    "getSetting" | "engineAnalyze" | "engineStop"
  > = api,
) {
  if (validateFen(fen).ok) {
    const chess = new Chess(fen);
    if (chess.isGameOver()) {
      onChange({
        fen,
        status: "",
        analysis: {
          fen,
          variations: [
            {
              rank: 1,
              depth: 0,
              scoreType: chess.isCheckmate() ? "mate" : "cp",
              scoreValue: 0,
              pv: [],
            },
          ],
        },
      });
      return () => {};
    }
  }
  let active = true;
  let started = false;
  let finished = false;
  let analysis: EngineAnalysis | null = null;
  const requestId = crypto.randomUUID();
  onChange({ fen, analysis, status: "分析中…" });
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const [path, depth] = await Promise.all([
          engineApi.getSetting("engine_path"),
          getEngineDepth("position", engineApi),
        ]);
        if (!active) return;
        if (!path) {
          onChange({ fen, analysis, status: "请在设置中配置 Stockfish 路径" });
          return;
        }
        started = true;
        const result = await engineApi.engineAnalyze(
          path,
          fen,
          depth,
          requestId,
          (update) => {
            if (!active || finished || update.fen !== fen) return;
            analysis = update;
            onChange({ fen, analysis, status: "分析中…" });
          },
          3,
        );
        finished = true;
        if (active && result.fen === fen) {
          onChange({ fen, analysis: result, status: "" });
        }
      } catch (error) {
        finished = true;
        if (active) onChange({ fen, analysis, status: String(error) });
      }
    })();
  }, 180);
  return () => {
    active = false;
    clearTimeout(timer);
    if (started && !finished)
      void engineApi.engineStop(requestId).catch(() => {});
  };
}
