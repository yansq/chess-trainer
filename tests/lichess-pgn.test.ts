import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLichessBatch, parsePgn } from "../src/features/games/pgn";

const pgn = readFileSync(
  new URL("./fixtures/games/lichess-game-site.pgn", import.meta.url),
  "utf8",
);
const record = {
  id: "fKi4wjFx",
  createdAt: 1790344770912,
  status: "resign",
  pgn,
};

describe("Lichess PGN identity", () => {
  it("parses the reported real export through the sync batch parser", () => {
    const [game] = parseLichessBatch([record], "CrownUpFish");
    expect(game).toMatchObject({
      id: "lichess:fKi4wjFx",
      externalGameId: "fKi4wjFx",
      userColor: "black",
      result: "white",
    });
    expect(game.moves).toHaveLength(60);
    expect(
      game.moves.every(
        (m) => m.gameId === game.id && m.id.startsWith(`${game.id}:`),
      ),
    ).toBe(true);
  });

  it.each([
    "https://lichess.org/fKi4wjFx",
    "https://lichess.org/game/fKi4wjFx",
    "https://lichess.org/fKi4wjFx/black",
    "https://lichess.org/fKi4wjFxABCD",
  ])("reads Site without GameId: %s", (site) => {
    const text = pgn
      .replace('[GameId "fKi4wjFx"]\n', "")
      .replace("https://lichess.org/game/fKi4wjFx", site);
    expect(parsePgn(text, "lichess").externalGameId).toBe("fKi4wjFx");
  });

  it("uses GameId when Site is absent", () => {
    expect(parsePgn(pgn.replace(/\[Site .*\]\n/, ""), "lichess").id).toBe(
      "lichess:fKi4wjFx",
    );
  });

  it("rejects conflicting headers and response IDs", () => {
    expect(() =>
      parseLichessBatch([{ ...record, id: "abcdefgh" }], "CrownUpFish"),
    ).toThrow("对局 abcdefgh 解析失败：棋谱 ID 不一致");
    expect(() =>
      parsePgn(
        pgn.replace('[GameId "fKi4wjFx"]', '[GameId "abcdefgh"]'),
        "lichess",
      ),
    ).toThrow("棋谱 GameId 与 Site 不一致");
  });

  it("rejects missing identity and does not match unrelated URLs", () => {
    const text = pgn
      .replace('[GameId "fKi4wjFx"]\n', "")
      .replace(
        "https://lichess.org/game/fKi4wjFx",
        "https://example.com/lichess.org/fKi4wjFx",
      );
    expect(() =>
      parseLichessBatch([{ ...record, pgn: text }], "CrownUpFish"),
    ).toThrow("棋谱 ID 不一致");
  });

  it("keeps local imports local", () => {
    expect(parsePgn(pgn, "local")).toMatchObject({
      source: "local",
      externalGameId: null,
    });
  });
});
