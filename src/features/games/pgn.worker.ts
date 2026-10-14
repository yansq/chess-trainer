import { parsePgn } from "./pgn";
import type { LichessExportGame } from "../../shared/types";

self.onmessage = (
  event: MessageEvent<{ batch: LichessExportGame[]; username: string }>,
) => {
  try {
    const games = event.data.batch.map((g) => {
      try {
        const game = parsePgn(g.pgn, "lichess", event.data.username);
        if (game.externalGameId !== g.id) throw new Error("棋谱 ID 不一致");
        return game;
      } catch (error) {
        throw new Error(`对局 ${g.id} 解析失败：${error}`);
      }
    });
    self.postMessage({ games });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
