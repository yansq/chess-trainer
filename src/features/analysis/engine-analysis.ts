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
          engineApi.getSetting("engine_depth"),
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
          Number(depth ?? 14),
          requestId,
          (update) => {
            if (!active || finished || update.fen !== fen) return;
            analysis = update;
            onChange({ fen, analysis, status: "分析中…" });
          },
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
