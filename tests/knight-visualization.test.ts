import { describe, expect, it } from "vitest";
import {
  isKnightMove,
  randomKnightExercise,
  shortestKnightPath,
  validateKnightPath,
} from "../src/features/visualization/knight";

const exercise = { from: "a1", to: "d4" };
describe("盲马训练", () => {
  it("随机题目始终使用棋盘内的两个不同坐标", () => {
    for (let i = 0; i < 1000; i++) {
      const { from, to } = randomKnightExercise();
      expect(from).toMatch(/^[a-h][1-8]$/);
      expect(to).toMatch(/^[a-h][1-8]$/);
      expect(from).not.toBe(to);
    }
  });
  it("接受不同最短路径、可选起点、大小写和多种分隔符", () => {
    for (const text of [
      "a1 b3 d4",
      "a1 c2 d4",
      "b3 d4",
      " A1，B3 → D4 ",
      "a1 -> c2 -> d4",
      "a1\nb3\nd4",
    ]) {
      const result = validateKnightPath(exercise, text);
      expect(result.verdict).toBe("最佳");
      expect(result.steps).toBe(2);
    }
  });
  it("合法但绕路的路径判为非最佳，包括重复经过已访问坐标", () => {
    const result = validateKnightPath(exercise, "a1 b3 a1 b3 d4");
    expect(result.verdict).toBe("非最佳");
    expect(result.steps).toBe(4);
    expect(result.shortestPath).toHaveLength(3);
  });
  it("拒绝空路径、非法坐标、杂乱文本、越界、原地移动及非法马步", () => {
    for (const text of [
      "",
      "  ",
      "a1 a2 d4",
      "a1 i9 d4",
      "a1 b0 d4",
      "a1 b3 b3 d4",
      "a1 abc b3 d4",
      "a1b3d4",
      "a1 b3 <script>",
    ]) {
      expect(validateKnightPath(exercise, text).verdict).toBe("不合法");
    }
    expect(validateKnightPath(exercise, "a1 b3").detail).toContain(
      "还没有到达终点 d4",
    );
    expect(validateKnightPath(exercise, "a1 a2 d4").detail).toContain(
      "第 1 步",
    );
    expect(isKnightMove("a1", "h2")).toBe(false);
  });
  it("处理角落、临近格及同坐标的最短距离", () => {
    for (const [from, to, distance] of [
      ["a1", "b3", 1],
      ["a1", "b2", 4],
      ["a1", "a2", 3],
      ["a1", "h8", 6],
      ["d4", "d4", 0],
    ] as const) {
      expect(shortestKnightPath(from, to)).toHaveLength(distance + 1);
    }
    expect(() => shortestKnightPath("i1", "a1")).toThrow();
  });
  it("全部4096组起终点的最短路径与独立全点对距离一致", () => {
    const squares = Array.from(
      { length: 64 },
      (_, i) => `${String.fromCharCode(97 + (i % 8))}${Math.floor(i / 8) + 1}`,
    );
    const distance = squares.map((_, i) =>
      squares.map((_, j) => {
        const dx = Math.abs((i % 8) - (j % 8)),
          dy = Math.abs(Math.floor(i / 8) - Math.floor(j / 8));
        return i === j ? 0 : dx * dy === 2 ? 1 : Infinity;
      }),
    );
    for (let k = 0; k < 64; k++)
      for (let i = 0; i < 64; i++)
        for (let j = 0; j < 64; j++)
          distance[i][j] = Math.min(
            distance[i][j],
            distance[i][k] + distance[k][j],
          );
    for (let i = 0; i < 64; i++) {
      for (let j = 0; j < 64; j++) {
        const path = shortestKnightPath(squares[i], squares[j]);
        expect(path[0]).toBe(squares[i]);
        expect(path.at(-1)).toBe(squares[j]);
        expect(path.length - 1).toBe(distance[i][j]);
        for (let step = 1; step < path.length; step++)
          expect(isKnightMove(path[step - 1], path[step])).toBe(true);
        if (i !== j)
          expect(
            validateKnightPath(
              { from: squares[i], to: squares[j] },
              path.join(" "),
            ).verdict,
          ).toBe("最佳");
      }
    }
  });
});
