import { describe, expect, it } from "vitest";
import { parsePgn } from "../src/features/games/pgn";
import type { EngineAnalysis } from "../src/shared/api";
import {
  evaluationChartPoints,
  evaluationChartPath,
} from "../src/features/analysis/evaluation-chart";

const game = parsePgn("1. e4 e5 2. Nf3 Nc6 *", "local");
const initial = game.moves[0].fenBefore;
const score = (
  fen: string,
  value: number,
  type: "cp" | "mate" = "cp",
): EngineAnalysis => ({
  fen,
  variations: [
    { rank: 1, depth: 14, scoreType: type, scoreValue: value, pv: [] },
  ],
});

describe("incremental evaluation chart", () => {
  it("keeps the full move axis while loading and leaves missing positions blank", () => {
    const partial = evaluationChartPoints(game.moves, initial, {
      [initial]: score(initial, 50),
    });
    expect(partial.map((p) => p.x)).toEqual([0, 250, 500, 750, 1000]);
    expect(partial.slice(1).every((p) => p.y === null)).toBe(true);
    expect(evaluationChartPath(partial).trim()).toBe(`M0,${partial[0].y}`);
    const nextFen = game.moves[0].fenAfter;
    const next = evaluationChartPoints(game.moves, initial, {
      [initial]: score(initial, 50),
      [nextFen]: score(nextFen, -50),
    });
    expect(next[0]).toEqual(partial[0]);
    expect(next[1].x).toBe(partial[1].x);
    expect(evaluationChartPath(next)).toContain("L250,");
  });
  it("breaks the path at missing scores rather than interpolating across them", () => {
    const last = game.moves.at(-1)!.fenAfter;
    const points = evaluationChartPoints(game.moves, initial, {
      [initial]: score(initial, 0),
      [last]: score(last, 100),
    });
    expect(evaluationChartPath(points)).not.toContain("L");
    expect(evaluationChartPath(points)).toContain("M1000,");
  });
  it("keeps white advantage above zero on either turn and handles mate", () => {
    const blackTurn = game.moves[0].fenAfter;
    const points = evaluationChartPoints(game.moves, initial, {
      [initial]: score(initial, 200),
      [blackTurn]: score(blackTurn, 200),
    });
    expect(points[0].y).toBe(points[1].y);
    expect(points[0].y).toBeLessThan(50);
    expect(
      evaluationChartPoints([], blackTurn, {
        [blackTurn]: score(blackTurn, 0, "mate"),
      })[0],
    ).toMatchObject({ x: 500, y: 0 });
  });
  it("maps labels and selection to actual mainline IDs, including a custom start", () => {
    const custom = parsePgn(
      '[SetUp "1"]\n[FEN "8/8/4k3/8/8/4K3/8/8 b - - 0 25"]\n25... Kf5 *',
      "local",
    );
    const points = evaluationChartPoints(
      custom.moves,
      custom.moves[0].fenBefore,
      {},
    );
    expect(points[0].id).toBeNull();
    expect(points[1]).toMatchObject({
      id: custom.moves[0].id,
      label: "25… Kf5",
    });
    expect(evaluationChartPoints([], initial, {})[0].x).toBe(500);
  });
});
