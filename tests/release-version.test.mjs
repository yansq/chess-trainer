import { describe, expect, it } from "vitest";
import { releaseVersion } from "../scripts/ci-version.mjs";

describe("自动发布版本", () => {
  it("同一基准每次push递增，同一次重跑沿用版本", () => {
    expect(releaseVersion("0.2.0", "1")).toBe("0.2.1");
    expect(releaseVersion("0.2.0", "2")).toBe("0.2.2");
    expect(releaseVersion("0.2.0", "2")).toBe("0.2.2");
  });
  it("保留主次版本与补丁偏移，允许失败留下空档", () => {
    expect(releaseVersion("0.3.0", "17")).toBe("0.3.17");
    expect(releaseVersion("1.0.10", "4")).toBe("1.0.14");
  });
  it("拒绝无效、缺失、零编号与数值溢出", () => {
    for (const run of [
      undefined,
      "",
      "0",
      "01",
      "-1",
      "1.2",
      "abc",
      "9007199254740992",
    ]) {
      expect(() => releaseVersion("0.2.0", run)).toThrow();
    }
    expect(() => releaseVersion("0.2.0-beta", "1")).toThrow();
    expect(() => releaseVersion("0.2.9007199254740991", "1")).toThrow();
  });
});
