import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPositionAnalysis } from "../src/features/analysis/engine-analysis";
import type { EngineAnalysis } from "../src/shared/api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function result(fen: string, depth = 14): EngineAnalysis {
  return {
    fen,
    variations: [1, 2, 3].map((rank) => ({
      rank,
      depth,
      scoreType: "cp",
      scoreValue: 20,
      pv: ["e2e4"],
    })),
  };
}
function setup() {
  const pending = deferred<EngineAnalysis>();
  const api = {
    getSetting: vi.fn(async (key: string): Promise<string | null> =>
      key === "engine_path" ? "/stockfish" : "14",
    ),
    engineAnalyze: vi.fn<
      (
        path: string,
        fen: string,
        depth: number,
        requestId?: string,
        onUpdate?: (a: EngineAnalysis) => void,
      ) => Promise<EngineAnalysis>
    >(() => pending.promise),
    engineStop: vi.fn<(requestId?: string) => Promise<void>>(async () => {}),
  };
  const changed = vi.fn();
  return { pending, api, changed };
}
describe("局面实时分析", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("快速切换只分析最后停留的局面，保留设定深度", async () => {
    const { api, changed } = setup();
    const first = startPositionAnalysis("A", changed, api);
    await vi.advanceTimersByTimeAsync(100);
    first();
    const second = startPositionAnalysis("B", changed, api);
    await vi.advanceTimersByTimeAsync(100);
    second();
    const last = startPositionAnalysis("C", changed, api);
    await vi.advanceTimersByTimeAsync(180);
    expect(api.engineAnalyze).toHaveBeenCalledTimes(1);
    expect(api.engineAnalyze.mock.calls[0].slice(0, 3)).toEqual([
      "/stockfish",
      "C",
      14,
    ]);
    expect(api.engineStop).not.toHaveBeenCalled();
    last();
  });
  it("分析完成前显示浅层结果，完成后忽略迟到的进度", async () => {
    const { api, pending, changed } = setup();
    const stop = startPositionAnalysis("A", changed, api);
    await vi.advanceTimersByTimeAsync(180);
    const update = api.engineAnalyze.mock.calls[0][4]!;
    update(result("A", 6));
    expect(changed).toHaveBeenLastCalledWith({
      fen: "A",
      analysis: result("A", 6),
      status: "分析中…",
    });
    pending.resolve(result("A"));
    await vi.advanceTimersByTimeAsync(0);
    update(result("A", 8));
    expect(changed).toHaveBeenLastCalledWith({
      fen: "A",
      analysis: result("A"),
      status: "",
    });
    stop();
    expect(api.engineStop).not.toHaveBeenCalled();
  });
  it("只取消自身请求，返回相同局面时也拒绝旧请求的结果和错误", async () => {
    const old = setup();
    const stop = startPositionAnalysis("A", old.changed, old.api);
    await vi.advanceTimersByTimeAsync(180);
    const [, , , requestId, update] = old.api.engineAnalyze.mock.calls[0];
    stop();
    expect(old.api.engineStop).toHaveBeenCalledWith(requestId);
    const newer = setup();
    const stopNew = startPositionAnalysis("A", newer.changed, newer.api);
    await vi.advanceTimersByTimeAsync(180);
    expect(newer.api.engineAnalyze.mock.calls[0][3]).not.toBe(requestId);
    old.changed.mockClear();
    update!(result("A", 10));
    old.pending.reject(new Error("分析已取消"));
    await vi.advanceTimersByTimeAsync(0);
    expect(old.changed).not.toHaveBeenCalled();
    stopNew();
  });
  it("读取设置期间离开页面，不启动已经失效的分析", async () => {
    const { api, changed } = setup();
    const settings = deferred<string>();
    api.getSetting.mockReturnValue(settings.promise);
    const stop = startPositionAnalysis("A", changed, api);
    await vi.advanceTimersByTimeAsync(180);
    stop();
    settings.resolve("/stockfish");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.engineAnalyze).not.toHaveBeenCalled();
  });
  it("切换后忽略旧请求迟到的最终结果", async () => {
    const { api, pending, changed } = setup();
    const stop = startPositionAnalysis("A", changed, api);
    await vi.advanceTimersByTimeAsync(180);
    stop();
    changed.mockClear();
    pending.resolve(result("A"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).not.toHaveBeenCalled();
  });
  it("引擎错误保留当前局面的浅层结果，显示错误信息", async () => {
    const { api, pending, changed } = setup();
    const stop = startPositionAnalysis("A", changed, api);
    await vi.advanceTimersByTimeAsync(180);
    const update = api.engineAnalyze.mock.calls[0][4]!;
    update(result("B", 5));
    expect(changed).toHaveBeenCalledTimes(1);
    update(result("A", 6));
    pending.reject(new Error("引擎提前退出"));
    await vi.advanceTimersByTimeAsync(0);
    expect(changed).toHaveBeenLastCalledWith({
      fen: "A",
      analysis: result("A", 6),
      status: "Error: 引擎提前退出",
    });
    stop();
  });
});
