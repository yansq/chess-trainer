import { describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import {
  startMoveQualityAnalysis,
  type MoveQuality,
} from "../src/features/analysis/move-quality";
import type { EngineAnalysis } from "../src/shared/api";
import type { Move } from "../src/shared/types";

function moveFor(side: "white" | "black"): Move {
  const chess = new Chess();
  if (side === "black") chess.move("e4");
  const fenBefore = chess.fen();
  const played = chess.move(side === "white" ? "e4" : "e5");
  return {
    id: side,
    gameId: "test",
    ply: side === "white" ? 1 : 2,
    san: played.san,
    uci: played.from + played.to,
    fenBefore,
    fenAfter: chess.fen(),
  };
}
function analysis(fen: string, scoreValue: number): EngineAnalysis {
  return {
    fen,
    variations: [
      {
        rank: 1,
        depth: 14,
        scoreType: "cp",
        scoreValue,
        pv: [fen.split(" ")[1] === "w" ? "d2d4" : "c7c5"],
      },
    ],
  };
}
function setup(move: Move) {
  const engineApi = {
    getSetting: vi.fn(async (key: string): Promise<string | null> =>
      key === "engine_path" ? "/stockfish" : null,
    ),
    engineAnalyze: vi.fn<
      (
        path: string,
        fen: string,
        depth: number,
        requestId?: string,
      ) => Promise<EngineAnalysis>
    >(async (_path, fen) => analysis(fen, 0)),
    engineStop: vi.fn<(requestId?: string) => Promise<void>>(async () => {}),
  };
  const changes: MoveQuality[] = [];
  return {
    engineApi,
    changes,
    changed: (q: MoveQuality) => changes.push(q),
    after: analysis(move.fenAfter, 0),
  };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("复盘双方招法等级", () => {
  for (const side of ["white", "black"] as const) {
    it.each([
      [100, "Inaccuracy"],
      [200, "Mistake"],
      [400, "Blunder"],
    ] as const)(`${side} 损失 %i 厘兵显示 %s`, async (loss, category) => {
      const move = moveFor(side);
      const t = setup(move);
      t.after.variations[0].scoreValue = side === "white" ? -loss : loss;
      const stop = startMoveQualityAnalysis(
        move,
        t.after,
        t.changed,
        t.engineApi,
      );
      await flush();
      expect(t.changes.at(-1)?.candidate?.category).toBe(category);
      expect(t.changes.at(-1)?.moveId).toBe(move.id);
      expect(t.engineApi.engineAnalyze).toHaveBeenCalledTimes(1);
      expect(t.engineApi.engineAnalyze.mock.calls[0][1]).toBe(move.fenBefore);
      stop();
      expect(t.engineApi.engineStop).not.toHaveBeenCalled();
    });
  }
  it("遵循设置中的阈值，正常招法不标记", async () => {
    const move = moveFor("white");
    const t = setup(move);
    t.after.variations[0].scoreValue = -100;
    t.engineApi.getSetting.mockImplementation(async (key) =>
      key === "engine_path"
        ? "/stockfish"
        : key === "loss_inaccuracy"
          ? "0.2"
          : null,
    );
    startMoveQualityAnalysis(move, t.after, t.changed, t.engineApi);
    await flush();
    expect(t.changes.at(-1)).toMatchObject({ candidate: null, status: "" });
  });
  it("不使用其他局面或空评价的引擎结果", async () => {
    const move = moveFor("white");
    const t = setup(move);
    t.engineApi.engineAnalyze.mockResolvedValue(analysis("wrong-fen", 100));
    startMoveQualityAnalysis(move, t.after, t.changed, t.engineApi);
    await flush();
    expect(t.changes.at(-1)).toMatchObject({
      candidate: null,
      status: "招法评估未返回有效结果",
    });
    t.engineApi.engineAnalyze.mockResolvedValue({
      fen: move.fenBefore,
      variations: [],
    });
    startMoveQualityAnalysis(move, t.after, t.changed, t.engineApi);
    await flush();
    expect(t.changes.at(-1)?.candidate).toBeNull();
  });
  it("切换招法只取消自身请求，迟到的结果不能覆盖当前标记", async () => {
    const move = moveFor("white");
    const t = setup(move);
    let resolve!: (a: EngineAnalysis) => void;
    t.engineApi.engineAnalyze.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const stop = startMoveQualityAnalysis(
      move,
      t.after,
      t.changed,
      t.engineApi,
    );
    await flush();
    stop();
    expect(t.engineApi.engineStop).toHaveBeenCalledWith(
      t.engineApi.engineAnalyze.mock.calls[0][3],
    );
    const count = t.changes.length;
    resolve(analysis(move.fenBefore, 800));
    await flush();
    expect(t.changes).toHaveLength(count);
  });
  it("读取设置时离开页面，不启动引擎", async () => {
    const move = moveFor("white");
    const t = setup(move);
    const stop = startMoveQualityAnalysis(
      move,
      t.after,
      t.changed,
      t.engineApi,
    );
    stop();
    await flush();
    expect(t.engineApi.engineAnalyze).not.toHaveBeenCalled();
  });
});
