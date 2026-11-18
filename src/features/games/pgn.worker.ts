import { parseChessComBatch, parseLichessBatch, parsePgnCollection } from "./pgn";
import type { ChessComGame, LichessExportGame } from "../../shared/types";

self.onmessage = (
  event: MessageEvent<
    | { source?: "lichess"; batch: LichessExportGame[]; username: string }
    | { source: "chesscom"; batch: ChessComGame[]; username: string }
    | {
        source: "local";
        text: string;
        username?: string;
        chessComUsername?: string;
      }
  >,
) => {
  try {
    const games =
      event.data.source === "local"
        ? parsePgnCollection(
            event.data.text,
            "local",
            event.data.username,
            event.data.chessComUsername,
          )
        : event.data.source === "chesscom"
          ? parseChessComBatch(event.data.batch, event.data.username)
          : parseLichessBatch(event.data.batch, event.data.username);
    self.postMessage({ games });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
