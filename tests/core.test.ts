import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parsePgnCollection } from "../src/features/games/pgn";
import { normalizeAnswer, uciLineToSan } from "../src/shared/chess/moves";
import { scheduleReview } from "../src/features/review/scheduler";
import type { Schedule } from "../src/shared/types";
const fixture = readFileSync(
  new URL("./fixtures/games/sample.pgn", import.meta.url),
  "utf8",
);
describe("PGN 主线", () => {
  const games = parsePgnCollection(fixture, "lichess", "Trainer");
  it("解析多局和用户视角", () => {
    expect(games).toHaveLength(2);
    expect(games[0].userColor).toBe("white");
    expect(games[1].userColor).toBe("black");
    expect(games[1].result).toBe("black");
  });
  it("ply 与 FEN 前后局面一致", () => {
    const moves = games[0].moves;
    expect(moves[0].ply).toBe(1);
    expect(moves[0].fenBefore).toContain(" w ");
    expect(moves[0].fenAfter).toContain(" b ");
    expect(moves[1].fenBefore).toBe(moves[0].fenAfter);
    expect(moves[1].id).toBe(`${games[0].id}:2`);
  });
  it("答案规范化兼容 SAN/UCI", () => {
    const fen = games[0].moves[0].fenBefore;
    expect(normalizeAnswer(fen, "e4")).toBe("e2e4");
    expect(normalizeAnswer(fen, "e2e4")).toBe("e2e4");
  });
});
describe("引擎变化的标准记号", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  it("逐步更新局面，转换兵、棋子、吃子和王车易位", () => {
    expect(uciLineToSan(start, ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5c6", "d7c6", "e1g1"]))
      .toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "O-O"]);
  });
  it("保留将军、将杀、升变和棋子消歧记号", () => {
    expect(uciLineToSan(start, ["f2f3", "e7e5", "g2g4", "d8h4"]))
      .toEqual(["f3", "e5", "g4", "Qh4#"]);
    expect(uciLineToSan("7k/P7/8/8/8/8/8/7K w - - 0 1", ["a7a8q"]))
      .toEqual(["a8=Q+"]);
    expect(uciLineToSan("7k/8/8/8/8/8/8/1N1N3K w - - 0 1", ["b1c3"]))
      .toEqual(["Nbc3"]);
  });
  it("无效变化只显示合法前缀", () => {
    expect(uciLineToSan(start, ["e2e4", "e2e3", "g1f3"]))
      .toEqual(["e4"]);
    expect(uciLineToSan("invalid", ["e2e4"])).toEqual([]);
  });
});
describe("SM-2", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  const base: Schedule = {
    puzzleId: "p",
    dueAt: now.toISOString(),
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    lastReviewedAt: null,
    totalAttempts: 0,
    correctCount: 0,
  };
  it("初次 Good 安排明天", () => {
    const n = scheduleReview(base, "Good", now);
    expect(n.repetitions).toBe(1);
    expect(n.intervalDays).toBe(1);
    expect(n.dueAt).toBe("2026-10-15T00:00:00.000Z");
  });
  it("Again 重置连续次数", () => {
    const n = scheduleReview(
      { ...base, repetitions: 5, intervalDays: 30 },
      "Again",
      now,
    );
    expect(n.repetitions).toBe(0);
    expect(n.lapses).toBe(1);
    expect(n.easeFactor).toBe(2.3);
  });
  it("第二次 Good 进入六日间隔", () => {
    const n = scheduleReview(
      { ...base, repetitions: 1, intervalDays: 1 },
      "Good",
      now,
    );
    expect(n.intervalDays).toBe(6);
  });
});
import { classifyMove } from "../src/features/analysis/blunders";
import type { EngineAnalysis } from "../src/shared/api";
describe("错题候选", () => {
  const games = parsePgnCollection(fixture, "lichess", "Trainer");
  const before: EngineAnalysis = {
    fen: games[0].moves[0].fenBefore,
    variations: [
      { rank: 1, depth: 14, scoreType: "cp", scoreValue: 250, pv: ["d2d4"] },
    ],
  };
  it("使用失误前局面且只评估用户颜色", () => {
    const after = {
      ...before,
      fen: games[0].moves[0].fenAfter,
      variations: [{ ...before.variations[0], scoreValue: -250 }],
    };
    const c = classifyMove(games[0].moves[0], "white", before, after);
    expect(c?.move.fenBefore).toBe(before.fen);
    expect(c?.category).toBe("Blunder");
    expect(c?.bestMove).toBe("d2d4");
    expect(c?.solutionLine).toEqual(["d2d4"]);
    expect(classifyMove(games[0].moves[0], "black", before, after)).toBeNull();
  });
  it("mate 评价按方向处理", () => {
    const a = {
      ...before,
      variations: [
        { ...before.variations[0], scoreType: "mate" as const, scoreValue: 3 },
      ],
    };
    const b = {
      ...before,
      variations: [
        { ...before.variations[0], scoreType: "mate" as const, scoreValue: -2 },
      ],
    };
    expect(classifyMove(games[0].moves[0], "white", a, b)?.category).toBe(
      "Blunder",
    );
  });
});

import { parsePgn } from "../src/features/games/pgn";
describe("Lichess 标题元数据", () => {
  it("从官方导出常见 Event 标签读取时限和 rated", () => {
    const pgn = `[Event "Rated Blitz game"]\n[Site "https://lichess.org/zxyw9876"]\n[White "Trainer"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0`;
    const game = parsePgn(pgn, "lichess", "Trainer");
    expect(game.speed).toBe("blitz");
    expect(game.rated).toBe(true);
  });
});
