import { Chess } from "chess.js";
import type { GameImport, LichessExportGame, Move } from "../../shared/types";

export function splitPgn(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n(?=\[Event\s+")/g)
    .map((p) => p.trim())
    .filter(Boolean);
}
function hash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
export function parsePgn(
  pgn: string,
  source: "local" | "lichess",
  username?: string,
): GameImport {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.header();
  const verbose = chess.history({ verbose: true });
  const site = headers.Site ?? "";
  let externalGameId: string | null = null;
  if (source === "lichess") {
    const siteId = site.match(
      /^https?:\/\/(?:www\.)?lichess\.org\/(?:game\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?=[/?#]|$)/,
    )?.[1];
    const headerId = headers.GameId;
    if (headerId && !/^[a-zA-Z0-9]{8}$/.test(headerId)) {
      throw new Error("棋谱 GameId 无效");
    }
    if (headerId && siteId && headerId !== siteId) {
      throw new Error("棋谱 GameId 与 Site 不一致");
    }
    externalGameId = headerId || siteId || null;
  }
  const id =
    source === "lichess" && externalGameId
      ? `lichess:${externalGameId}`
      : `local:${hash(pgn.trim())}`;
  const moves: Move[] = verbose.map((m, i) => ({
    id: `${id}:${i + 1}`,
    gameId: id,
    ply: i + 1,
    san: m.san,
    uci: `${m.from}${m.to}${m.promotion ?? ""}`,
    fenBefore: m.before,
    fenAfter: m.after,
  }));
  const whitePlayer = headers.White ?? "未知";
  const blackPlayer = headers.Black ?? "未知";
  const userColor =
    username?.toLowerCase() === whitePlayer.toLowerCase()
      ? "white"
      : username?.toLowerCase() === blackPlayer.toLowerCase()
        ? "black"
        : null;
  const result =
    headers.Result === "1-0"
      ? "white"
      : headers.Result === "0-1"
        ? "black"
        : headers.Result === "1/2-1/2"
          ? "draw"
          : "unknown";
  const date = (headers.UTCDate ?? headers.Date ?? "").replaceAll(".", "-");
  const playedAt = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? headers.UTCTime
      ? `${date}T${headers.UTCTime}Z`
      : date
    : null;
  const event = headers.Event ?? "";
  const eventSpeed =
    event
      .match(/\b(Bullet|Blitz|Rapid|Classical|Correspondence)\b/i)?.[1]
      .toLowerCase() ?? null;
  return {
    id,
    source,
    externalGameId,
    whitePlayer,
    blackPlayer,
    userColor,
    result,
    playedAt,
    timeControl: headers.TimeControl ?? null,
    speed: headers.Speed?.toLowerCase() ?? eventSpeed,
    rated:
      headers.Rated === "true"
        ? true
        : headers.Rated === "false"
          ? false
          : /^Rated\b/i.test(event)
            ? true
            : /^Casual\b/i.test(event)
              ? false
              : null,
    eco: headers.ECO ?? null,
    openingName: headers.Opening ?? null,
    pgn,
    reviewStatus: false,
    moves,
  };
}
export function parsePgnCollection(
  text: string,
  source: "local" | "lichess",
  username?: string,
): GameImport[] {
  return splitPgn(text).map((p) => parsePgn(p, source, username));
}

export function parseLichessBatch(
  batch: LichessExportGame[],
  username: string,
): GameImport[] {
  return batch.map((record) => {
    try {
      const game = parsePgn(record.pgn, "lichess", username);
      if (game.externalGameId !== record.id) {
        throw new Error("棋谱 ID 不一致");
      }
      return game;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`对局 ${record.id} 解析失败：${message}`);
    }
  });
}
