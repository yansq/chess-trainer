export type ClipboardWriter = (text: string) => Promise<void>;

export type CopyFenFailureReason = "empty" | "unavailable" | "failed";

export type CopyFenResult =
  | { ok: true; fen: string }
  | { ok: false; reason: CopyFenFailureReason; message: string };

const COPY_FAILED_MESSAGE = "复制 FEN 失败，请重试";

export async function copyFenToClipboard(
  fen: string | undefined,
  writer?: ClipboardWriter,
): Promise<CopyFenResult> {
  if (!fen || fen.trim().length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "当前没有可复制的局面 FEN",
    };
  }

  const clipboard = globalThis.navigator?.clipboard;
  const writeText: ClipboardWriter | undefined =
    writer ??
    (typeof clipboard?.writeText === "function"
      ? // Preserve navigator.clipboard as `this` for host-bound implementations.
        (text) => clipboard.writeText(text)
      : undefined);

  if (!writeText) {
    return {
      ok: false,
      reason: "unavailable",
      message: COPY_FAILED_MESSAGE,
    };
  }

  try {
    await writeText(fen);
    return { ok: true, fen };
  } catch {
    return {
      ok: false,
      reason: "failed",
      message: COPY_FAILED_MESSAGE,
    };
  }
}
