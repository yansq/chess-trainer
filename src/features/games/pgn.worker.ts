import { parseLichessBatch } from "./pgn";
import type { LichessExportGame } from "../../shared/types";

self.onmessage = (
  event: MessageEvent<{ batch: LichessExportGame[]; username: string }>,
) => {
  try {
    const games = parseLichessBatch(event.data.batch, event.data.username);
    self.postMessage({ games });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
