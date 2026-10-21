import { describe, expect, it } from "vitest";
import { upcomingDueDays } from "../src/features/review/due-forecast";

describe("未来三天到期日期", () => {
  it.each([
    [new Date(2026, 9, 20, 23, 59), ["2026-10-21", "2026-10-22", "2026-10-23"]],
    [new Date(2026, 11, 30, 12), ["2026-12-31", "2027-01-01", "2027-01-02"]],
    [new Date(2028, 1, 28, 12), ["2028-02-29", "2028-03-01", "2028-03-02"]],
  ])("从本地日期生成完整三天范围 %s", (now, dates) => {
    const result = upcomingDueDays(now);
    expect(result.dates).toEqual(dates);
    expect(result.boundaries).toHaveLength(3);
    result.boundaries.forEach((value, index) => {
      const day = new Date(value);
      expect(day.getHours()).toBe(0);
      expect(day.getTime()).toBe(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + index + 2,
        ).getTime(),
      );
    });
  });
  it("夏令时变化仍按本地午夜划分，不使用固定24小时", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const result = upcomingDueDays(new Date(2026, 2, 6, 12));
      expect(result.dates).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
      expect(
        new Date(result.boundaries[1]).getTime() -
          new Date(result.boundaries[0]).getTime(),
      ).toBe(23 * 60 * 60 * 1000);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
