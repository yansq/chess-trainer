import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import fixtures from "./fixtures/openings.json";
import catalogue from "../src/shared/chess/lichess-openings.json";
import version from "../data/openings/version.json";
import { classifyOpening } from "../src/shared/chess/openings";
import { parsePgn } from "../src/features/games/pgn";

describe("shared Lichess opening classification", () => {
  it.each(fixtures)(
    "classifies $id by the last named position",
    ({ pgn, moves, expected }) => {
      expect(classifyOpening(moves)).toEqual(expected);
      expect(parsePgn(pgn, "local")).toMatchObject(expected);
    },
  );
  it("ignores conflicting platform headers, retaining the original PGN", () => {
    const line = fixtures[0].pgn;
    for (const source of ["local", "lichess", "chesscom"] as const) {
      const pgn = `[ECO "A00"]\n[Opening "Wrong name"]\n[ECOUrl "https://www.chess.com/openings/Incorrect-Opening-3.Nc3"]\n\n${line}`;
      expect(parsePgn(pgn, source)).toMatchObject({
        ...fixtures[0].expected,
        pgn,
      });
    }
  });
  it("ignores move counters but retains castling and side-to-move rights", () => {
    const last = fixtures[2].moves.at(-1)!;
    const modified = {
      ...last,
      fenAfter: last.fenAfter.split(" ").slice(0, 4).join(" ") + " 87 99",
    };
    expect(classifyOpening([modified])).toEqual(fixtures[2].expected);
    for (const fenAfter of [
      modified.fenAfter.replace(" w ", " b "),
      modified.fenAfter.replace("KQkq", "-"),
    ]) {
      expect(classifyOpening([{ fenBefore: "", fenAfter }])).toEqual({
        eco: null,
        openingName: null,
      });
    }
  });
  it("keeps valid en-passant rights in the indexed position", () => {
    const chess = new Chess();
    for (const move of ["e4", "h6", "e5", "d5"]) chess.move(move);
    expect(chess.fen().split(" ")[3]).toBe("d6");
    expect(classifyOpening([{ fenBefore: "", fenAfter: chess.fen() }])).toEqual(
      { eco: null, openingName: null },
    );
  });
  it("ships the complete pinned catalogue with valid ECO keys", () => {
    expect(Object.keys(catalogue)).toHaveLength(version.positions);
    expect(version.records).toBeGreaterThan(3000);
    for (const [fen, [eco, name]] of Object.entries(catalogue)) {
      expect(fen.split(" ")).toHaveLength(4);
      expect(eco).toMatch(/^[A-E]\d{2}$/);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
