import { describe, expect, it } from "vitest";
import { offsetForIndex } from "../src/features/games/filter-store";

describe("offsetForIndex", () => {
  it("maps a 0-based game index to its page offset", () => {
    expect(offsetForIndex(0, 10)).toBe(0);
    expect(offsetForIndex(9, 10)).toBe(0);
    expect(offsetForIndex(10, 10)).toBe(10);
    expect(offsetForIndex(23, 10)).toBe(20);
  });

  it("clamps negative indexes and non-positive limits", () => {
    expect(offsetForIndex(-3, 10)).toBe(0);
    expect(offsetForIndex(5, 0)).toBe(5);
  });
});
