import { describe, expect, it, vi } from "vitest";
import {
  getEngineDepth,
  normalizeEngineDepth,
} from "../src/features/analysis/engine-settings";

describe("独立分析深度设置", () => {
  it("分别读取预分析和局面深度，不被旧值覆盖", async () => {
    const values: Record<string, string> = {
      engine_preanalysis_depth: "16",
      engine_position_depth: "22",
      engine_depth: "18",
    };
    const api = {
      getSetting: vi.fn(async (key: string) => values[key] ?? null),
    };
    expect(await getEngineDepth("preanalysis", api)).toBe(16);
    expect(await getEngineDepth("position", api)).toBe(22);
    expect(api.getSetting).not.toHaveBeenCalledWith("engine_depth");
  });
  it("未单独配置的项继承旧深度，另一项仍独立生效", async () => {
    const values: Record<string, string> = {
      engine_position_depth: "24",
      engine_depth: "22",
    };
    const api = {
      getSetting: vi.fn(async (key: string) => values[key] ?? null),
    };
    expect(await getEngineDepth("preanalysis", api)).toBe(22);
    expect(await getEngineDepth("position", api)).toBe(24);
  });
  it("全新配置默认14，异常值和边界保持合法范围", async () => {
    expect(
      await getEngineDepth("preanalysis", { getSetting: async () => null }),
    ).toBe(14);
    expect(
      ["bad", "Infinity", "2", "40", "18.8"].map(normalizeEngineDepth),
    ).toEqual([14, 14, 4, 30, 18]);
  });
});
