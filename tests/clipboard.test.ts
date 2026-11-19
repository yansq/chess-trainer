import { afterEach, describe, expect, it, vi } from "vitest";
import { copyFenToClipboard } from "../src/shared/clipboard";

const SAMPLE_FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("copyFenToClipboard", () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );

  function setNavigator(value: unknown) {
    Object.defineProperty(globalThis, "navigator", {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  });

  it("在有效 FEN 时调用写入器并返回成功结果", async () => {
    const writer = vi.fn(async () => {});
    const result = await copyFenToClipboard(SAMPLE_FEN, writer);

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(SAMPLE_FEN);
    expect(result).toEqual({ ok: true, fen: SAMPLE_FEN });
  });

  it("拒绝 undefined、空字符串与空白 FEN 且不触发写入", async () => {
    const writer = vi.fn(async () => {});

    for (const emptyFen of [undefined, "", "   \t\n "]) {
      const result = await copyFenToClipboard(emptyFen, writer);
      expect(result).toEqual({
        ok: false,
        reason: "empty",
        message: "当前没有可复制的局面 FEN",
      });
    }
    expect(writer).not.toHaveBeenCalled();
  });

  it("剪贴板 API 不可用时返回 unavailable", async () => {
    setNavigator(undefined);
    expect(await copyFenToClipboard(SAMPLE_FEN)).toEqual({
      ok: false,
      reason: "unavailable",
      message: "复制 FEN 失败，请重试",
    });

    setNavigator({});
    expect(await copyFenToClipboard(SAMPLE_FEN)).toEqual({
      ok: false,
      reason: "unavailable",
      message: "复制 FEN 失败，请重试",
    });

    setNavigator({ clipboard: {} });
    expect(await copyFenToClipboard(SAMPLE_FEN)).toEqual({
      ok: false,
      reason: "unavailable",
      message: "复制 FEN 失败，请重试",
    });
  });

  it("调用 navigator.clipboard.writeText 时保留 this 绑定", async () => {
    const received: string[] = [];
    const clipboard = {
      tag: "host-clipboard",
      async writeText(this: { tag?: string }, text: string) {
        if (this?.tag !== "host-clipboard") {
          throw new TypeError("Illegal invocation");
        }
        received.push(text);
      },
    };
    setNavigator({ clipboard });

    const result = await copyFenToClipboard(SAMPLE_FEN);
    expect(result).toEqual({ ok: true, fen: SAMPLE_FEN });
    expect(received).toEqual([SAMPLE_FEN]);
  });

  it("写入器抛错或 reject 时返回 failed", async () => {
    const writer = vi.fn(async () => {
      throw new Error("permission denied");
    });

    const result = await copyFenToClipboard(SAMPLE_FEN, writer);
    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "复制 FEN 失败，请重试",
    });
  });
});
