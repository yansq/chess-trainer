import { describe, expect, it, vi } from "vitest";
import {
  startGameAnalysis,
  type GameAnalysis,
} from "../src/features/analysis/game-analysis";
import { parsePgn } from "../src/features/games/pgn";
import { Chess } from "chess.js";
import type { EngineAnalysis } from "../src/shared/api";

const moves = parsePgn("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *", "local").moves;
const fens = [moves[0].fenBefore, ...moves.map((m) => m.fenAfter)];
function result(fen: string): EngineAnalysis {
  const index = fens.indexOf(fen);
  const best = new Chess(fen)
    .moves({ verbose: true })
    .find((m) => m.from + m.to + (m.promotion ?? "") !== moves[index]?.uci)!;
  return {
    fen,
    variations: [
      {
        rank: 1,
        depth: 14,
        scoreType: "cp",
        scoreValue: [0, -100, 0, -200, 0, -400, 0][index] ?? 0,
        pv: [best.from + best.to + (best.promotion ?? "")],
      },
    ],
  };
}
function setup() {
  const states: GameAnalysis[] = [];
  const api = {
    getSetting: vi.fn(async (key: string): Promise<string | null> =>
      key === "engine_path" ? "/stockfish" : null,
    ),
    engineAnalyze: vi.fn(
      async (
        _path: string,
        fen: string,
        _depth: number,
        _requestId?: string,
      ): Promise<EngineAnalysis> => {
        void _depth;
        void _requestId;
        return result(fen);
      },
    ),
    engineStop: vi.fn(async (_id?: string) => {
      void _id;
    }),
  };
  const changed = (s: GameAnalysis) => states.push(s);
  return { api, states, changed };
}
async function settle() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

describe("整局顺序预分析", () => {
  it("不导航也按顺序评价双方所有招法，相邻招法共享局面并逐步发布三类标识", async () => {
    const { api, states, changed } = setup();
    const stop = startGameAnalysis(moves, fens[0], changed, api);
    await settle();
    expect(api.engineAnalyze.mock.calls.map((c) => c[1])).toEqual(fens);
    const last = states.at(-1)!;
    expect(last.completed).toBe(6);
    expect(last.status).toBe("整局分析完成 6 / 6");
    expect(moves.map((m) => last.qualities[m.id].candidate?.category)).toEqual([
      "Inaccuracy",
      "Inaccuracy",
      "Mistake",
      "Mistake",
      "Blunder",
      "Blunder",
    ]);
    expect([...new Set(states.map((s) => s.completed))]).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(new Set(api.engineAnalyze.mock.calls.map((c) => c[3])).size).toBe(7);
    stop();
    expect(api.engineStop).not.toHaveBeenCalled();
  });
  it("整局预分析也自动发布 Good，且不作为失误题目候选", async () => {
    const { api, states, changed } = setup();
    api.engineAnalyze.mockImplementation(async (_p, fen) => {
      const a = result(fen);
      a.variations[0].scoreValue = 0;
      return a;
    });
    startGameAnalysis(moves, fens[0], changed, api);
    await settle();
    expect(
      Object.values(states.at(-1)!.qualities).map((q) => q.category),
    ).toEqual(Array(6).fill("Good"));
    expect(
      Object.values(states.at(-1)!.qualities).every(
        (q) => q.candidate === null,
      ),
    ).toBe(true);
  });
  it("使用设置中的深度与阈值", async () => {
    const { api, states, changed } = setup();
    api.getSetting.mockImplementation(
      async (k) =>
        ({
          engine_path: "/custom",
          engine_depth: "18",
          loss_inaccuracy: "0.9",
          loss_mistake: "0.95",
          loss_blunder: "0.99",
        })[k] ?? null,
    );
    startGameAnalysis(moves, fens[0], changed, api);
    await settle();
    expect(
      api.engineAnalyze.mock.calls.every(
        (c) => c[0] === "/custom" && c[2] === 18,
      ),
    ).toBe(true);
    expect(
      Object.values(states.at(-1)!.qualities).every(
        (q) => q.candidate === null,
      ),
    ).toBe(true);
  });
  it("失败保留已完成标记，并停止后续工作", async () => {
    const { api, states, changed } = setup();
    api.engineAnalyze.mockImplementation(async (_p, fen) => {
      if (fen === fens[2]) throw Error("engine exited");
      return result(fen);
    });
    startGameAnalysis(moves, fens[0], changed, api);
    await settle();
    expect(states.at(-1)).toMatchObject({ failed: true, completed: 1 });
    expect(states.at(-1)!.qualities[moves[0].id].candidate?.category).toBe(
      "Inaccuracy",
    );
    expect(api.engineAnalyze).toHaveBeenCalledTimes(3);
  });
  it("离开时只取消自己的请求，忽略迟到结果且不启动下一步", async () => {
    const { api, states, changed } = setup();
    let resolve!: (r: EngineAnalysis) => void;
    api.engineAnalyze.mockReturnValue(new Promise((r) => (resolve = r)));
    const stop = startGameAnalysis(moves, fens[0], changed, api);
    await settle();
    const count = states.length;
    stop();
    expect(api.engineStop).toHaveBeenCalledWith(
      api.engineAnalyze.mock.calls[0][3],
    );
    resolve(result(fens[0]));
    await settle();
    expect(states).toHaveLength(count);
    expect(api.engineAnalyze).toHaveBeenCalledTimes(1);
  });
  it("读取设置时离开，不启动引擎", async () => {
    const { api, changed } = setup();
    let resolve!: (v: string) => void;
    api.getSetting.mockReturnValue(new Promise((r) => (resolve = r)));
    const stop = startGameAnalysis(moves, fens[0], changed, api);
    stop();
    resolve("/stockfish");
    await settle();
    expect(api.engineAnalyze).not.toHaveBeenCalled();
  });
  it("无引擎配置不误报招法质量", async () => {
    const { api, states, changed } = setup();
    api.getSetting.mockResolvedValue(null);
    startGameAnalysis(moves, fens[0], changed, api);
    await settle();
    expect(states.at(-1)).toMatchObject({
      qualities: {},
      completed: 0,
      status: "请在设置中配置 Stockfish 路径",
    });
    expect(api.engineAnalyze).not.toHaveBeenCalled();
  });
  it.each(["wrong-fen", "empty"])("拒绝无效结果 %s", async (kind) => {
    const { api, states, changed } = setup();
    api.engineAnalyze.mockResolvedValue(
      kind === "empty" ? { fen: fens[0], variations: [] } : result(fens[1]),
    );
    startGameAnalysis(moves, fens[0], changed, api);
    await settle();
    expect(states.at(-1)).toMatchObject({
      failed: true,
      completed: 0,
      qualities: {},
    });
  });
  it("将死终局不请求无合法招法的引擎局面，仍完成最后一步", async () => {
    const { api, states, changed } = setup();
    const mateMoves = parsePgn("1. f3 e5 2. g4 Qh4# 0-1", "local").moves;
    startGameAnalysis(mateMoves, mateMoves[0].fenBefore, changed, api);
    await settle();
    expect(states.at(-1)).toMatchObject({ failed: false, completed: 4 });
    expect(api.engineAnalyze).toHaveBeenCalledTimes(4);
    const terminal = states.at(-1)!.positions[mateMoves[3].fenAfter];
    expect(terminal.variations[0]).toMatchObject({
      scoreType: "mate",
      scoreValue: 0,
      pv: [],
    });
    expect(states.at(-1)!.qualities[mateMoves[3].id].candidate).toBeNull();
  });
  it("逼和终局直接给出和棋评价", async () => {
    const { api, states, changed } = setup();
    const fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    startGameAnalysis([], fen, changed, api);
    await settle();
    expect(states.at(-1)).toMatchObject({ failed: false, completed: 0 });
    expect(states.at(-1)!.positions[fen].variations[0]).toMatchObject({
      scoreType: "cp",
      scoreValue: 0,
    });
    expect(api.engineAnalyze).not.toHaveBeenCalled();
  });
});
