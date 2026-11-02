import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  ChessComGame,
  ChessComSyncState,
  GameImport,
} from "../src/shared/types";
import {
  chessComStateKey,
  readChessComState,
  syncChessComGames,
} from "../src/features/games/chesscom-sync";
import {
  chessComGameId,
  parseChessComBatch,
  parseLichessBatch,
  parsePgnCollection,
} from "../src/features/games/pgn";

const pgn = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.03"]
[White "Trainer"]
[Black "Opponent"]
[Result "1-0"]
[ECO "B90"]
[ECOUrl "https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation"]
[Link "https://www.chess.com/game/live/123"]

1. e4 e5 2. Nf3 Nc6 1-0`;
const record: ChessComGame = {
  url: "https://www.chess.com/game/live/123",
  pgn,
  rules: "chess",
  time_class: "rapid",
  time_control: "600+5",
  end_time: Date.parse("2026-10-03T12:00:00Z") / 1000,
  rated: true,
  white: { username: "Trainer", result: "win" },
  black: { username: "Opponent", result: "resigned" },
};
function harness() {
  let state = readChessComState(null),
    pause = false,
    failed = "";
  const saved = new Map<string, GameImport>(),
    requests: string[] = [];
  const deps = {
    getState: async () => structuredClone(state),
    archives: async () => ["2026/08", "2026/09", "2026/10"],
    fetchMonth: async (month: string) => {
      requests.push(month);
      if (failed === month) throw Error("offline");
      const n = Number(month.slice(5));
      return [
        {
          ...record,
          url: record.url.replace("123", String(n)),
          pgn: record.pgn.replaceAll("/123", "/" + n),
          end_time:
            Date.parse(month.replace("/", "-") + "-03T12:00:00Z") / 1000,
        },
      ];
    },
    parseBatch: async (batch: ChessComGame[]) =>
      parseChessComBatch(batch, "trainer"),
    saveBatch: async (games: GameImport[], next: ChessComSyncState) => {
      const added = games.filter((g) => !saved.has(g.id)).length;
      games.forEach((g) => saved.set(g.id, g));
      state = { ...structuredClone(next), added: next.added + added };
      return structuredClone(state);
    },
    onProgress: (next: ChessComSyncState) => {
      if (next.read === 1 && pause) pause = true;
    },
    shouldPause: () => pause,
    now: () => Date.parse("2026-10-29T00:00:00Z"),
  };
  return {
    deps,
    requests,
    saved,
    state: () => state,
    fail: (month: string) => {
      failed = month;
    },
    pause: (value: boolean) => {
      pause = value;
    },
  };
}
describe("Chess.com import", () => {
  it("normalizes stable IDs, usernames, speed, opening and all move IDs", () => {
    const [game] = parseChessComBatch([record], "TRAINER");
    expect(game).toMatchObject({
      id: "chesscom:live:123",
      externalGameId: "live:123",
      userColor: "white",
      source: "chesscom",
      speed: "rapid",
      rated: true,
      eco: "C44",
      openingName: "King's Knight Opening: Normal Variation",
    });
    expect(game.moves).toHaveLength(4);
    expect(
      game.moves.every(
        (m) => m.gameId === game.id && m.id.startsWith(game.id + ":"),
      ),
    ).toBe(true);
    expect(chessComGameId("https://www.chess.com/live/game/123")).toBe(
      "live:123",
    );
    expect(chessComGameId("https://www.chess.com/game/daily/123")).toBe(
      "daily:123",
    );
    expect(chessComGameId("https://chess.com.evil/game/live/123")).toBeNull();
  });
  it("identifies manual Chess.com PGN using its platform account and matches synced IDs", () => {
    const [manual] = parsePgnCollection(
      pgn,
      "local",
      "different-lichess-account",
      "Trainer",
    );
    expect(manual.id).toBe(parseChessComBatch([record], "trainer")[0].id);
    expect(manual.userColor).toBe("white");
  });
  it("rejects mismatched identities and skips nonstandard or unfinished games", () => {
    expect(() =>
      parseChessComBatch(
        [{ ...record, url: record.url.replace("123", "456") }],
        "Trainer",
      ),
    ).toThrow("ID");
    expect(() => parseChessComBatch([record], "SomeoneElse")).toThrow("账号");
    expect(() =>
      parseChessComBatch(
        [{ ...record, black: { username: "Other", result: "resigned" } }],
        "Trainer",
      ),
    ).toThrow("账号");
    expect(
      parseChessComBatch(
        [{ ...record, rules: "chess960", pgn: "not PGN" }],
        "Trainer",
      ),
    ).toEqual([]);
    expect(
      parseChessComBatch(
        [{ ...record, pgn: pgn.replaceAll("1-0", "*") }],
        "Trainer",
      ),
    ).toEqual([]);
    expect(
      parseLichessBatch(
        [
          {
            id: "x",
            createdAt: 1,
            status: "mate",
            pgn: '[Variant "Chess960"]\n\ninvalid',
          },
        ],
        "Trainer",
      ),
    ).toEqual([]);
  });
});
describe("Chess.com incremental sync", () => {
  it("imports history then only refreshes recent months without duplicate games", async () => {
    const h = harness();
    const first = await syncChessComGames(h.deps);
    expect(first.pending).toBeNull();
    expect(first.added).toBe(3);
    expect(h.saved.size).toBe(3);
    h.requests.length = 0;
    const next = await syncChessComGames(h.deps);
    expect(h.requests).toEqual(["2026/09", "2026/10"]);
    expect(next.added).toBe(0);
    expect(h.saved.size).toBe(3);
  });
  it("keeps the failed month pending and resumes without replaying completed history", async () => {
    const h = harness();
    h.fail("2026/09");
    await expect(syncChessComGames(h.deps)).rejects.toThrow("offline");
    expect(h.state().pending).toEqual(["2026/09", "2026/10"]);
    expect(h.saved.size).toBe(1);
    h.fail("");
    h.requests.length = 0;
    await syncChessComGames(h.deps);
    expect(h.requests).toEqual(["2026/09", "2026/10"]);
    expect(h.saved.size).toBe(3);
  });
  it("can pause before reading a month and resume the persisted plan", async () => {
    const h = harness();
    h.pause(true);
    const stopped = await syncChessComGames(h.deps);
    expect(stopped.pending).toHaveLength(3);
    expect(h.requests).toEqual([]);
    h.pause(false);
    expect((await syncChessComGames(h.deps)).pending).toBeNull();
  });
  it("does not advance after parse failure or wrong-month responses", async () => {
    const h = harness();
    h.deps.parseBatch = async () => {
      throw Error("bad PGN");
    };
    await expect(syncChessComGames(h.deps)).rejects.toThrow("bad PGN");
    expect(h.state().pending?.[0]).toBe("2026/08");
    const other = harness();
    other.deps.fetchMonth = async () => [record];
    await expect(syncChessComGames(other.deps)).rejects.toThrow("月份");
    expect(other.state().pending?.[0]).toBe("2026/08");
  });
  it("validates persisted checkpoints and separates accounts", () => {
    expect(chessComStateKey(" Trainer ")).toBe("chesscom_sync_v1:trainer");
    expect(() =>
      readChessComState(
        '{"completedMonths":[],"pending":["2026/13"],"read":0,"added":0}',
      ),
    ).toThrow();
  });
});

it("parses an actual Chess.com public archive game with clock comments", () => {
  const real = JSON.parse(
    readFileSync(
      new URL("./fixtures/games/chesscom-public-game.json", import.meta.url),
      "utf8",
    ),
  ) as ChessComGame;
  const [game] = parseChessComBatch([real], "Hikaru");
  expect(game).toMatchObject({
    id: "chesscom:live:132168079769",
    source: "chesscom",
    userColor: "black",
    result: "black",
    speed: "bullet",
    eco: "B01",
  });
  expect(game.moves.length).toBeGreaterThan(60);
  expect(game.openingName).toMatch(/^Scandinavian Defense/);
  expect(parsePgnCollection(real.pgn, "local", undefined, "Hikaru")[0].id).toBe(
    game.id,
  );
});
