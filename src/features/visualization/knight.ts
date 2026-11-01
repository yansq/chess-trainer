const squarePattern = /^[a-h][1-8]$/;
const offsets = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

export type KnightExercise = { from: string; to: string };
export type KnightResult = {
  verdict: "不合法" | "非最佳" | "最佳";
  detail: string;
  steps: number;
  shortestPath: string[];
};

function squareAt(index: number): string {
  return `${String.fromCharCode(97 + (index % 8))}${Math.floor(index / 8) + 1}`;
}

export function randomKnightExercise(): KnightExercise {
  const from = Math.floor(Math.random() * 64);
  const to = (from + 1 + Math.floor(Math.random() * 63)) % 64;
  return { from: squareAt(from), to: squareAt(to) };
}

export function isKnightMove(from: string, to: string): boolean {
  if (!squarePattern.test(from) || !squarePattern.test(to)) return false;
  const file = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const rank = Math.abs(Number(from[1]) - Number(to[1]));
  return (file === 1 && rank === 2) || (file === 2 && rank === 1);
}

export function shortestKnightPath(from: string, to: string): string[] {
  if (!squarePattern.test(from) || !squarePattern.test(to))
    throw new Error("起点或终点坐标无效");
  const parents = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !parents.has(to); i++) {
    const current = queue[i];
    const file = current.charCodeAt(0) - 97;
    const rank = Number(current[1]) - 1;
    for (const [dx, dy] of offsets) {
      const x = file + dx,
        y = rank + dy;
      if (x < 0 || x > 7 || y < 0 || y > 7) continue;
      const next = squareAt(y * 8 + x);
      if (parents.has(next)) continue;
      parents.set(next, current);
      queue.push(next);
    }
  }
  const path: string[] = [];
  let current: string | null = to;
  while (current !== null) {
    path.unshift(current);
    current = parents.get(current) ?? null;
  }
  return path;
}

export function validateKnightPath(
  exercise: KnightExercise,
  text: string,
): KnightResult {
  const shortestPath = shortestKnightPath(exercise.from, exercise.to);
  const tokens = text
    .trim()
    .toLowerCase()
    .split(/[\s,，、;；→>-]+/)
    .filter(Boolean);
  const path =
    tokens[0] === exercise.from ? tokens : [exercise.from, ...tokens];
  const steps = path.length - 1;
  const invalid = (detail: string): KnightResult => ({
    verdict: "不合法",
    detail,
    steps,
    shortestPath,
  });
  if (!tokens.length) return invalid("请填写马经过的坐标，并以终点结束。");
  for (const square of tokens) {
    if (!squarePattern.test(square))
      return invalid(
        `“${square}”不是有效坐标，请使用 a1 至 h8，并用空格、逗号或 → 分隔。`,
      );
  }
  for (let i = 1; i < path.length; i++) {
    if (!isKnightMove(path[i - 1], path[i]))
      return invalid(
        `第 ${i} 步：${path[i - 1]} → ${path[i]} 不是马的合法走法。`,
      );
  }
  if (path[path.length - 1] !== exercise.to)
    return invalid(
      `路径停在 ${path[path.length - 1]}，还没有到达终点 ${exercise.to}。`,
    );
  if (steps !== shortestPath.length - 1)
    return {
      verdict: "非最佳",
      detail: "路径合法，但还有更短的走法，可以继续尝试。",
      steps,
      shortestPath,
    };
  return {
    verdict: "最佳",
    detail: "路径合法，且已达到最短步数！",
    steps,
    shortestPath,
  };
}
