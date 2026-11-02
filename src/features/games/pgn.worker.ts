import { parseChessComBatch, parseLichessBatch } from "./pgn";
import type { ChessComGame, LichessExportGame } from "../../shared/types";

self.onmessage = (
  event: MessageEvent<
    | { source?: "lichess"; batch: LichessExportGame[]; username: string }
    | { source: "chesscom"; batch: ChessComGame[]; username: string }
  >,
) => {
  try {
    const games =
      event.data.source === "chesscom"
        ? parseChessComBatch(event.data.batch, event.data.username)
        : parseLichessBatch(event.data.batch, event.data.username);
    self.postMessage({ games });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
