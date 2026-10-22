import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { EngineAnalysis } from "../src/shared/api";
import { positionEvaluation } from "../src/features/analysis/evaluation";

const whiteFen = new Chess().fen();
const blackFen = whiteFen.replace(" w ", " b ");
function analysis(
  fen: string,
  scoreValue: number,
  scoreType: "cp" | "mate" = "cp",
): EngineAnalysis {
  return {
    fen,
    variations: [{ rank: 1, depth: 14, scoreType, scoreValue, pv: [] }],
  };
}

describe("board evaluation", () => {
  it("keeps the backend's White perspective even on Black's turn", () => {
    for (const fen of [whiteFen, blackFen]) {
      const white = positionEvaluation(fen, analysis(fen, 250))!;
      const black = positionEvaluation(fen, analysis(fen, -250))!;
      expect(white.label).toBe("+2.5");
      expect(white.whitePercent).toBeGreaterThan(50);
      expect(black.label).toBe("−2.5");
      expect(black.whitePercent).toBeCloseTo(100 - white.whitePercent);
      expect(positionEvaluation(fen, analysis(fen, 0))?.whitePercent).toBe(50);
    }
  });
  it("handles forced mate and an already checkmated side correctly", () => {
    expect(
      positionEvaluation(blackFen, analysis(blackFen, 3, "mate")),
    ).toMatchObject({ label: "M3", whitePercent: 100 });
    expect(
      positionEvaluation(whiteFen, analysis(whiteFen, -2, "mate")),
    ).toMatchObject({ label: "−M2", whitePercent: 0 });
    expect(
      positionEvaluation(whiteFen, analysis(whiteFen, 0, "mate")),
    ).toMatchObject({ label: "0–1", whitePercent: 0 });
    expect(
      positionEvaluation(blackFen, analysis(blackFen, 0, "mate")),
    ).toMatchObject({ label: "1–0", whitePercent: 100 });
  });
  it("does not show another position's score while waiting for analysis", () => {
    expect(positionEvaluation(whiteFen, null)).toBeNull();
    expect(positionEvaluation(blackFen, analysis(whiteFen, 100))).toBeNull();
    expect(
      positionEvaluation(whiteFen, { fen: whiteFen, variations: [] }),
    ).toBeNull();
    expect(positionEvaluation(whiteFen, analysis(whiteFen, NaN))).toBeNull();
  });
  it("bounds extreme scores and keeps labels compact", () => {
    expect(
      positionEvaluation(whiteFen, analysis(whiteFen, 100000)),
    ).toMatchObject({ label: "+1000", whitePercent: 98 });
    expect(
      positionEvaluation(whiteFen, analysis(whiteFen, -100000))?.whitePercent,
    ).toBe(2);
  });
});
