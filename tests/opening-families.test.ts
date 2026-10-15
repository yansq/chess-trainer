import { describe, expect, it } from "vitest";
import { groupOpeningFamilies } from "../src/features/statistics/opening-families";
import type { OpeningStat } from "../src/shared/types";

function stat(
  eco: string,
  opening: string,
  wins: number,
  draws: number,
  losses: number,
): OpeningStat {
  const total = wins + draws + losses;
  return {
    eco,
    opening,
    total,
    wins,
    draws,
    losses,
    winRate: total ? wins / total : 0,
    scoreRate: total ? (wins + draws * 0.5) / total : 0,
  };
}

describe("开局大类统计", () => {
  it("合并不同 ECO 的同一大类，按合计局数重新计算胜率和得分率", () => {
    const rows = [
      stat("B20", "Sicilian Defense: Bowdler Attack", 1, 0, 0),
      stat("B40", "Sicilian Defense: French Variation", 0, 2, 7),
    ];
    const before = structuredClone(rows);
    expect(groupOpeningFamilies(rows)).toEqual([
      {
        opening: "Sicilian Defense",
        total: 10,
        wins: 1,
        draws: 2,
        losses: 7,
        winRate: 0.1,
        scoreRate: 0.2,
      },
    ]);
    expect(rows).toEqual(before);
  });

  it("按名称而非 ECO 归类，基础开局与其子变例合并", () => {
    const rows = [
      stat("A00", "Hungarian Opening", 1, 0, 0),
      stat("A00", "Grob Opening", 0, 0, 1),
      stat("C60", "Ruy Lopez", 1, 0, 0),
      stat(
        "C65",
        " Ruy Lopez: Berlin Defense, Anti-Berlin Variation ",
        0,
        1,
        1,
      ),
    ];
    const grouped = groupOpeningFamilies(rows);
    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({
      opening: "Ruy Lopez",
      total: 3,
      wins: 1,
      draws: 1,
      losses: 1,
    });
    for (const field of ["total", "wins", "draws", "losses"] as const) {
      expect(grouped.reduce((sum, row) => sum + row[field], 0)).toBe(
        rows.reduce((sum, row) => sum + row[field], 0),
      );
    }
  });

  it("缺少名称时归为未知，空数据和零样本不产生无效比例", () => {
    expect(groupOpeningFamilies([])).toEqual([]);
    expect(
      groupOpeningFamilies([
        stat("—", "  ", 0, 0, 0),
        stat("—", "未知开局", 0, 1, 0),
      ]),
    ).toEqual([
      {
        opening: "未知开局",
        total: 1,
        wins: 0,
        draws: 1,
        losses: 0,
        winRate: 0,
        scoreRate: 0.5,
      },
    ]);
    expect(groupOpeningFamilies([stat("—", "", 0, 0, 0)])[0]).toMatchObject({
      winRate: 0,
      scoreRate: 0,
    });
  });
});
