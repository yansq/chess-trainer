import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import {
  parsePuzzleAnswers,
  isMultiMovePuzzle,
} from "../src/features/puzzles/answers";
import {
  isWaitingForReply,
  playPuzzleMove,
  playPuzzleReply,
  schedulePuzzleReply,
} from "../src/features/review/attempt";
import type { Puzzle } from "../src/shared/types";

const start = new Chess().fen();
function puzzle(text = "e4 e5 Nf3 Nc6 Bb5", fen = start): Puzzle {
  return {
    id: "multi",
    category: "opening",
    sourceType: "manual",
    sourceGameId: null,
    sourceMoveId: null,
    fen,
    sideToMove: fen.split(" ")[1] === "w" ? "white" : "black",
    title: "连续多步",
    description: "",
    originalMove: null,
    ...parsePuzzleAnswers(fen, text, true),
    errorCategory: null,
  };
}

describe("多步题目录入", () => {
  it("按更新后的局面校验 SAN 和混合 UCI，保存首步和完整答案", () => {
    expect(parsePuzzleAnswers(start, "e4 e7e5 Nf3", true)).toEqual({
      expectedMoves: ["e2e4"],
      solutionLine: ["e2e4", "e7e5", "g1f3"],
    });
    expect(parsePuzzleAnswers(start, "  e2e4\ne5，g1f3  ", true)).toEqual(
      parsePuzzleAnswers(start, "e4 e5 Nf3", true),
    );
  });
  it("拒绝非法中间步骤，指出具体位置；不接受空答案", () => {
    expect(() => parsePuzzleAnswers(start, "e4 Nf3", true)).toThrow(
      "第 2 步「Nf3」",
    );
    expect(() => parsePuzzleAnswers(start, "e4 e5 e4", true)).toThrow(
      "第 3 步「e4」",
    );
    expect(() => parsePuzzleAnswers(start, " ", true)).toThrow("请输入");
  });
  it("保持单步多答案语义，互不顺序执行", () => {
    expect(parsePuzzleAnswers(start, "e4, d4 Nf3", false)).toEqual({
      expectedMoves: ["e2e4", "d2d4", "g1f3"],
      solutionLine: [],
    });
    expect(() => parsePuzzleAnswers(start, "e4 e5", false)).toThrow("e5");
  });
  it("连续答案支持王车易位、吃子和升变", () => {
    expect(
      parsePuzzleAnswers(
        start,
        "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O",
        true,
      ).solutionLine.at(-1),
    ).toBe("e1g1");
    expect(
      parsePuzzleAnswers("7k/P7/8/8/8/8/8/7K w - - 0 1", "a8=N Kh7", true)
        .solutionLine,
    ).toEqual(["a7a8n", "h8h7"]);
  });
});

describe("连续解题", () => {
  it("分开执行自己的落子和对手应手，等待时不能提前走下一步", () => {
    const p = puzzle();
    const first = playPuzzleMove(p, null, "e2", "e4")!;
    expect(first.moves).toEqual(["e2e4"]);
    const board = new Chess();
    board.move("e4");
    expect(first.fen).toBe(board.fen());
    expect(isWaitingForReply(first)).toBe(true);
    expect(first.complete).toBe(false);
    expect(playPuzzleMove(p, first, "g1", "f3")).toBeNull();
    const reply = playPuzzleReply(p, first)!;
    board.move("e5");
    expect(reply.fen).toBe(board.fen());
    expect(reply.moves).toEqual(["e2e4", "e7e5"]);
    expect(isWaitingForReply(reply)).toBe(false);
    expect(playPuzzleReply(p, reply)).toBeNull();
    const second = playPuzzleMove(p, reply, "g1", "f3")!;
    expect(second.moves).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(second.complete).toBe(false);
    const secondReply = playPuzzleReply(p, second)!;
    expect(secondReply.moves).toEqual(["e2e4", "e7e5", "g1f3", "b8c6"]);
    const last = playPuzzleMove(p, secondReply, "f1", "b5")!;
    expect(last).toMatchObject({ correct: true, complete: true });
    expect(playPuzzleMove(p, last, "a7", "a6")).toBeNull();
    expect(playPuzzleReply(p, last)).toBeNull();
  });
  it("错误后续步保留局面和进度，可以反复重试直至答对", () => {
    const p = puzzle();
    const first = playPuzzleReply(p, playPuzzleMove(p, null, "e2", "e4")!)!;
    const wrong = playPuzzleMove(p, first, "d2", "d4")!;
    expect(wrong).toMatchObject({ correct: false, complete: false });
    expect(wrong.fen).toBe(first.fen);
    expect(wrong.moves).toEqual(["e2e4", "e7e5"]);
    expect(isWaitingForReply(wrong)).toBe(false);
    const again = playPuzzleMove(p, wrong, "b1", "c3")!;
    expect(again.fen).toBe(first.fen);
    expect(again.moves).toEqual(first.moves);
    const right = playPuzzleMove(p, again, "g1", "f3")!;
    expect(right.correct).toBe(true);
    const reply = playPuzzleReply(p, right)!;
    expect(playPuzzleMove(p, reply, "f1", "b5")).toMatchObject({
      correct: true,
      complete: true,
    });
    expect(playPuzzleReply(p, wrong)).toBeNull();
    expect(playPuzzleMove(p, first, "e2", "e4")).toBeNull();
    expect(first.moves).toEqual(["e2e4", "e7e5"]);
  });
  it("单步题和多步题首步答错可重试，非法走法也不推进", () => {
    for (const p of [
      puzzle(),
      { ...puzzle(), ...parsePuzzleAnswers(start, "e4,d4", false) },
    ]) {
      const wrong = playPuzzleMove(p, null, "g1", "f3")!;
      expect(wrong).toMatchObject({
        fen: start,
        moves: [],
        correct: false,
        complete: false,
      });
      expect(isWaitingForReply(wrong)).toBe(false);
      expect(playPuzzleMove(p, wrong, "e2", "e5")).toBeNull();
      expect(playPuzzleMove(p, wrong, "e2", "e4")?.correct).toBe(true);
    }
  });
  it("黑方题从来源局面开始；答案可在对手应手后结束", () => {
    const board = new Chess();
    board.move("e4");
    const p = puzzle("e5 Nf3 Nc6", board.fen());
    const first = playPuzzleMove(p, null, "e7", "e5")!;
    expect(first.moves).toEqual(["e7e5"]);
    expect(first.complete).toBe(false);
    const reply = playPuzzleReply(p, first)!;
    expect(reply.moves).toEqual(["e7e5", "g1f3"]);
    expect(playPuzzleMove(p, reply, "b8", "c6")).toMatchObject({
      correct: true,
      complete: true,
    });
    const endsWithReply = puzzle("e4 e5");
    const beforeReply = playPuzzleMove(endsWithReply, null, "e2", "e4")!;
    expect(beforeReply.complete).toBe(false);
    expect(playPuzzleReply(endsWithReply, beforeReply)).toMatchObject({
      correct: true,
      complete: true,
    });
  });
  it("旧单步和自动题仍在第一步结束，自动题变化仅供参考", () => {
    const manual = {
      ...puzzle(),
      ...parsePuzzleAnswers(start, "e4,d4", false),
    };
    expect(isMultiMovePuzzle(manual)).toBe(false);
    expect(playPuzzleMove(manual, null, "d2", "d4")).toMatchObject({
      correct: true,
      complete: true,
      moves: ["d2d4"],
    });
    const auto = { ...puzzle(), sourceType: "auto" as const };
    expect(isMultiMovePuzzle(auto)).toBe(false);
    expect(playPuzzleMove(auto, null, "e2", "e4")).toMatchObject({
      correct: true,
      complete: true,
      moves: ["e2e4"],
    });
  });
  it("升变保留指定棋子，错误的损坏应手不会静默通过", () => {
    const p = puzzle("a8=N Kh7", "7k/P7/8/8/8/8/8/7K w - - 0 1");
    const promoted = playPuzzleMove(p, null, "a7", "a8", "n")!;
    expect(promoted).toMatchObject({ san: "a8=N", complete: false });
    expect(playPuzzleReply(p, promoted)).toMatchObject({
      correct: true,
      complete: true,
    });
    const broken = { ...puzzle(), solutionLine: ["e2e4", "e2e3", "g1f3"] };
    expect(() => playPuzzleMove(broken, null, "e2", "e4")).toThrow(
      "对手应手不合法",
    );
  });
});

describe("对手应手间隔", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("等待 400 毫秒再落子；以对手应手结束的题目此前不能评级", () => {
    const p = puzzle("e4 e5");
    const played = playPuzzleMove(p, null, "e2", "e4")!;
    const onReply = vi.fn();
    const onError = vi.fn();
    schedulePuzzleReply(p, played, onReply, onError);
    vi.advanceTimersByTime(399);
    expect(onReply).not.toHaveBeenCalled();
    expect(played).toMatchObject({ moves: ["e2e4"], complete: false });
    vi.advanceTimersByTime(1);
    expect(onReply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        moves: ["e2e4", "e7e5"],
        san: "e5",
        complete: true,
        correct: true,
      }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("离开题目时取消等待，不再更新棋盘或播放对手落子", () => {
    const p = puzzle();
    const onReply = vi.fn();
    const onError = vi.fn();
    const cancel = schedulePuzzleReply(
      p,
      playPuzzleMove(p, null, "e2", "e4")!,
      onReply,
      onError,
    );
    vi.advanceTimersByTime(200);
    cancel();
    vi.runAllTimers();
    expect(onReply).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
