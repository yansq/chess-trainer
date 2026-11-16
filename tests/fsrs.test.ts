import { describe, it, expect } from "vitest";
import {
  scheduleReview,
  previewNextIntervals,
} from "../src/features/review/scheduler";
import {
  calculateRetrievability,
  calculateInterval,
  initialDifficulty,
  initialStability,
  difficultyToEaseFactor,
  easeFactorToDifficulty,
  DEFAULT_FSRS_PARAMS,
} from "../src/features/review/fsrs";
import type { Schedule } from "../src/shared/types";

describe("FSRS 基础数学函数", () => {
  it("可提取性 Retrievability 在 t=S 时等于 0.9", () => {
    const r = calculateRetrievability(10, 10);
    expect(r).toBeCloseTo(0.9, 2);
  });

  it("当 t 增长时 Retrievability 单调下降", () => {
    const r1 = calculateRetrievability(5, 10);
    const r2 = calculateRetrievability(10, 10);
    const r3 = calculateRetrievability(20, 10);
    expect(r1).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r3);
  });

  it("当目标保留率为 90% 时，计算间隔等于稳定性 round(S)", () => {
    expect(calculateInterval(10, 0.9)).toBe(10);
    expect(calculateInterval(3.17, 0.9)).toBe(3);
    expect(calculateInterval(15.69, 0.9)).toBe(16);
  });

  it("目标保留率越严格（如 95%），计算间隔越短", () => {
    const normal = calculateInterval(30, 0.9);
    const strict = calculateInterval(30, 0.95);
    const relaxed = calculateInterval(30, 0.8);
    expect(strict).toBeLessThan(normal);
    expect(relaxed).toBeGreaterThan(normal);
  });

  it("Ease Factor 与 Difficulty 的双向映射平滑且受边界约束", () => {
    expect(difficultyToEaseFactor(1)).toBe(2.5);
    expect(difficultyToEaseFactor(10)).toBe(1.3);
    expect(easeFactorToDifficulty(2.5)).toBeCloseTo(1.0, 1);
    expect(easeFactorToDifficulty(1.3)).toBeCloseTo(10.0, 1);
  });

  it("初始难度和初始稳定性符合 FSRS 理论设定", () => {
    expect(initialStability(3, DEFAULT_FSRS_PARAMS)).toBeCloseTo(3.173, 2);
    expect(initialDifficulty(3, DEFAULT_FSRS_PARAMS)).toBeGreaterThan(4);
    expect(initialDifficulty(1, DEFAULT_FSRS_PARAMS)).toBeGreaterThan(
      initialDifficulty(4, DEFAULT_FSRS_PARAMS),
    );
  });
});

describe("FSRS 首次学习调度", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const base: Schedule = {
    puzzleId: "puzzle-1",
    dueAt: now.toISOString(),
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    lastReviewedAt: null,
    totalAttempts: 0,
    correctCount: 0,
  };

  it("初次 Again：遗忘次数 +1，连续次数 0，安排次日巩固", () => {
    const next = scheduleReview(base, "Again", now);
    expect(next.repetitions).toBe(0);
    expect(next.lapses).toBe(1);
    expect(next.intervalDays).toBe(1);
    expect(next.dueAt).toBe("2026-10-15T12:00:00.000Z");
    expect(next.difficulty).toBeGreaterThan(5);
  });

  it("初次 Hard：安排短间隔（1 天），连续次数 1", () => {
    const next = scheduleReview(base, "Hard", now);
    expect(next.repetitions).toBe(1);
    expect(next.lapses).toBe(0);
    expect(next.intervalDays).toBe(1);
    expect(next.difficulty).toBeGreaterThan(5);
  });

  it("初次 Good：安排约 3 天间隔", () => {
    const next = scheduleReview(base, "Good", now);
    expect(next.repetitions).toBe(1);
    expect(next.lapses).toBe(0);
    expect(next.intervalDays).toBe(3);
    expect(next.stability).toBeCloseTo(3.17, 1);
    expect(next.dueAt).toBe("2026-10-17T12:00:00.000Z");
  });

  it("初次 Easy：安排约 16 天长间隔，难度较低", () => {
    const next = scheduleReview(base, "Easy", now);
    expect(next.repetitions).toBe(1);
    expect(next.lapses).toBe(0);
    expect(next.intervalDays).toBe(16);
    expect(next.stability).toBeCloseTo(15.69, 1);
    expect(next.difficulty).toBeLessThan(4);
  });
});

describe("FSRS 避免 SM-2 缺陷（软着陆与防难度地狱）", () => {
  const t0 = new Date("2026-10-01T00:00:00.000Z");
  const t1 = new Date("2026-10-31T00:00:00.000Z"); // 30 天后

  const matureCard: Schedule = {
    puzzleId: "mature",
    dueAt: t1.toISOString(),
    intervalDays: 30,
    easeFactor: 2.3,
    stability: 30,
    difficulty: 3.5,
    repetitions: 4,
    lapses: 0,
    lastReviewedAt: t0.toISOString(),
    totalAttempts: 4,
    correctCount: 4,
  };

  it("做错（Again）时实行软着陆，绝不将稳定性清空为 0", () => {
    const failed = scheduleReview(matureCard, "Again", t1);
    expect(failed.repetitions).toBe(0);
    expect(failed.lapses).toBe(1);
    expect(failed.intervalDays).toBe(1); // 次日即时巩固
    // 稳定性应显著减少但仍保留部分记忆痕迹（软着陆，远大于 0.5）
    expect(failed.stability).toBeGreaterThan(2.0);
    expect(failed.stability).toBeLessThan(30);

    // 巩固一天后再次做对（Good），间隔应迅速回升，无需经历 10 次漫长攀爬
    const t2 = new Date("2026-11-01T00:00:00.000Z");
    const recovered = scheduleReview(failed, "Good", t2);
    expect(recovered.repetitions).toBe(1);
    expect(recovered.intervalDays).toBeGreaterThan(1);
  });

  it("连续选择 Hard 不会卡死在 1.3 难度地狱（均值回归保护）", () => {
    let cur = matureCard;
    for (let i = 0; i < 5; i++) {
      cur = scheduleReview(cur, "Hard", new Date(t1.getTime() + i * 86400000));
    }
    expect(cur.difficulty).toBeLessThanOrEqual(10);
    expect(cur.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("成熟卡片回答 Good 随时间间隔平滑扩张", () => {
    const next = scheduleReview(matureCard, "Good", t1);
    expect(next.repetitions).toBe(5);
    expect(next.intervalDays).toBeGreaterThan(matureCard.intervalDays);
    expect(next.stability).toBeGreaterThan(matureCard.stability!);
  });
});

describe("FSRS 预估间隔预览 previewNextIntervals", () => {
  it("四档评分的下一次复习间隔呈现单调有序性", () => {
    const now = new Date("2026-10-14T00:00:00.000Z");
    const current: Schedule = {
      puzzleId: "preview-test",
      dueAt: now.toISOString(),
      intervalDays: 7,
      easeFactor: 2.2,
      stability: 7,
      difficulty: 4.5,
      repetitions: 2,
      lapses: 0,
      lastReviewedAt: new Date("2026-10-07T00:00:00.000Z").toISOString(),
      totalAttempts: 2,
      correctCount: 2,
    };

    const previews = previewNextIntervals(current, now);
    expect(previews.Again).toBe(1);
    expect(previews.Hard).toBeGreaterThanOrEqual(1);
    expect(previews.Good).toBeGreaterThan(previews.Hard);
    expect(previews.Easy).toBeGreaterThan(previews.Good);
  });
});
