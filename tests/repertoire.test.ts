import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  addMove,
  childrenOf,
  deleteBranch,
  exportRepertoirePgn,
  importRepertoirePgn,
  newRepertoire,
  pathTo,
  positionKey,
  promoteNode,
} from "../src/features/repertoire/model";
const pgn =
  "{起点说明} 1.e4 {中心计划} c6 (1...e5 $1 {开放局面} 2.Nf3 (2.Bc4 {象的路线}) Nc6) 2.d4 d5 *";
const base = () => newRepertoire("Anti Caro-Kann", "white");
const imported = () => importRepertoirePgn(base(), pgn);
describe("opening repertoire", () => {
  it("imports all nested variations, position comments, and NAGs", () => {
    const book = imported();
    expect(book.nodes).toHaveLength(8);
    const root = childrenOf(book, null)[0];
    expect(childrenOf(book, root.id).map((n) => n.san)).toEqual(["c6", "e5"]);
    const e5 = book.nodes.find((n) => n.san === "e5")!;
    expect(childrenOf(book, e5.id).map((n) => n.san)).toEqual(["Nf3", "Bc4"]);
    expect(e5.nags).toEqual(["$1"]);
    expect(book.notes[positionKey(book.initialFen)]).toBe("起点说明");
    expect(book.notes[positionKey(root.fenAfter)]).toBe("中心计划");
  });
  it("merges repeated PGN without duplicate lines, comments, or loss of disabled status", () => {
    const book = imported();
    book.nodes[1].disabled = true;
    const merged = importRepertoirePgn(book, pgn);
    expect(merged.nodes).toEqual(book.nodes);
    expect(merged.notes).toEqual(book.notes);
  });
  it("uses the same node when playing an existing move and rejects illegal moves", () => {
    const book = imported();
    const result = addMove(book, null, "e2", "e4");
    expect(result.book).toBe(book);
    expect(() => addMove(book, null, "e2", "e5")).toThrow();
    expect(book.nodes).toHaveLength(8);
  });
  it("extends an imported branch leaf with legal moves", () => {
    const book = imported();
    const leaf = book.nodes.find((n) => n.san === "Bc4")!;
    expect(childrenOf(book, leaf.id)).toHaveLength(0);
    const extended = addMove(book, leaf.id, "g8", "f6");
    expect(extended.node.parentId).toBe(leaf.id);
    expect(extended.node.san).toBe("Nf6");
    const reopened = importRepertoirePgn(
      base(),
      exportRepertoirePgn(extended.book),
    );
    expect(reopened.nodes.some((n) => n.san === "Nf6")).toBe(true);
  });
  it("rejects continuation after checkmate", () => {
    const book = importRepertoirePgn(base(), "1.f3 e5 2.g4 Qh4# 0-1");
    const mate = book.nodes.at(-1)!;
    expect(new Chess(mate.fenAfter).isCheckmate()).toBe(true);
    expect(() => addMove(book, mate.id, "a2", "a3")).toThrow("该招法不合法");
    expect(childrenOf(book, mate.id)).toHaveLength(0);
  });
  it("exports/imports nested lines, Unicode multiline notes, NAGs and disabled branches", () => {
    const book = imported();
    const e5 = book.nodes.find((n) => n.san === "e5")!;
    e5.disabled = true;
    book.notes[positionKey(e5.fenAfter)] = "中文 {计划}\n第二行；100%";
    const round = importRepertoirePgn(base(), exportRepertoirePgn(book));
    const fingerprint = (b: typeof book) =>
      b.nodes
        .map((n) => ({
          path: pathTo(b, n.id)
            .map((n) => n.uci)
            .join(" "),
          disabled: n.disabled,
          nags: n.nags,
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
    expect(fingerprint(round)).toEqual(fingerprint(book));
    expect(round.notes).toEqual(book.notes);
  });
  it("rejects illegal moves and invalid FEN without mutating the existing book", () => {
    const book = imported(),
      before = structuredClone(book);
    expect(() => importRepertoirePgn(book, "1.d4 d5 (1...e4) *")).toThrow();
    expect(() =>
      importRepertoirePgn(book, '[SetUp "1"]\n[FEN "invalid"]\n\n1.Kf4 *'),
    ).toThrow();
    expect(book).toEqual(before);
  });
  it("accepts multiple games and merges transposition comments by position without merging branch identity", () => {
    const book = importRepertoirePgn(
      base(),
      '[Event "A"]\n\n1.Nf3 d5 2.d4 {计划甲} *\n\n[Event "B"]\n\n1.d4 d5 2.Nf3 {计划乙} *',
    );
    expect(book.nodes).toHaveLength(6);
    const ends = book.nodes.filter(
      (n) => ["d4", "Nf3"].includes(n.san) && pathTo(book, n.id).length === 3,
    );
    expect(positionKey(ends[0].fenAfter)).toBe(positionKey(ends[1].fenAfter));
    expect(book.notes[positionKey(ends[0].fenAfter)]).toContain("计划甲");
    expect(book.notes[positionKey(ends[0].fenAfter)]).toContain("计划乙");
    const round = importRepertoirePgn(base(), exportRepertoirePgn(book));
    expect(round.nodes).toHaveLength(6);
    expect(round.notes).toEqual(book.notes);
    expect(importRepertoirePgn(round, exportRepertoirePgn(book)).notes).toEqual(
      book.notes,
    );
    const removed = deleteBranch(book, childrenOf(book, null)[0].id);
    expect(removed.nodes).toHaveLength(3);
    expect(removed.notes[positionKey(ends[0].fenAfter)]).toBe(
      book.notes[positionKey(ends[0].fenAfter)],
    );
  });
  it("supports custom initial FEN and underpromotion", () => {
    const fen = "7k/P7/8/8/8/8/8/7K w - - 0 1";
    const book = newRepertoire("promotion", "white", fen);
    const next = addMove(book, null, "a7", "a8", "n");
    expect(next.node.san).toBe("a8=N");
    const round = importRepertoirePgn(book, exportRepertoirePgn(next.book));
    expect(round.nodes[0].uci).toBe("a7a8n");
  });
  it("promotes alternatives without losing tree data and deletes only the selected descendants", () => {
    const book = imported(),
      e5 = book.nodes.find((n) => n.san === "e5")!;
    const promoted = promoteNode(book, e5.id);
    expect(childrenOf(promoted, e5.parentId)[0].id).toBe(e5.id);
    expect(promoted.nodes).toHaveLength(book.nodes.length);
    const removed = deleteBranch(promoted, e5.id);
    expect(removed.nodes.map((n) => n.san)).toEqual(["e4", "c6", "d4", "d5"]);
  });
  it("preserves legal en passant rights in position identity", () => {
    const chess = new Chess();
    for (const move of ["e4", "h6", "e5", "d5"]) chess.move(move);
    expect(positionKey(chess.fen())).toContain("d6");
    expect(positionKey(chess.fen())).not.toBe(
      positionKey(chess.fen().replace("d6", "-")),
    );
  });
});

describe("teaching PGN compatibility", () => {
  it("preserves Z0 null moves, turn changes, continuations, annotations and alternatives", () => {
    const book = importRepertoirePgn(
      base(),
      "{intro} 1.Z0 {wait} e5 (1...d5) 2.Nf3 *",
    );
    const pass = book.nodes.find((n) => n.uci === "0000")!;
    const chess = new Chess();
    chess.move(null);
    expect(pass.fenAfter).toBe(chess.fen());
    expect(pass.san).toBe("--");
    expect(childrenOf(book, pass.id).map((n) => n.san)).toEqual(["e5", "d5"]);
    expect(book.notes[positionKey(pass.fenAfter)]).toBe("wait");
    const round = importRepertoirePgn(base(), exportRepertoirePgn(book));
    expect(round.nodes.map((n) => [n.uci, n.fenAfter])).toEqual(
      book.nodes.map((n) => [n.uci, n.fenAfter]),
    );
    expect(round.notes).toEqual(book.notes);
  });
  it("skips unreachable analysis chapters with their moves and notes", () => {
    const text =
      '[SetUp "1"]\n[FEN "8/8/4k3/8/8/4K3/8/8 b - - 0 25"]\n\n{orphan} 25...Kd5 {orphan move} *\n\n[Event "Main"]\n\n1.e4 e5 *';
    const book = importRepertoirePgn(base(), text);
    expect(book.nodes.map((n) => n.san)).toEqual(["e4", "e5"]);
    expect(book.notes).toEqual({});
  });
  it("can match analysis starts against existing full lines", () => {
    const book = importRepertoirePgn(base(), "1.e4 e5 *");
    const fen = book.nodes[0].fenAfter;
    const result = importRepertoirePgn(
      book,
      `[SetUp "1"]\n[FEN "${fen}"]\n\n1...c5 *`,
    );
    expect(result.nodes.some((n) => n.uci === "@fen")).toBe(false);
    expect(result.nodes.find((n) => n.san === "c5")!.parentId).toBe(
      book.nodes[0].id,
    );
    expect(result.nodes.some((n) => n.san === "c5")).toBe(true);
  });
  it("joins chapters made reachable by other chapters in the same import", () => {
    const chess = new Chess();
    chess.move("e4");
    const e4 = chess.fen();
    chess.move("c5");
    const c5 = chess.fen();
    const text = `[SetUp "1"]\n[FEN "${c5}"]\n\n2.Nf3 *\n\n[SetUp "1"]\n[FEN "${e4}"]\n\n1...c5 *\n\n[Event "Main"]\n\n1.e4 *`;
    const book = importRepertoirePgn(base(), text);
    expect(book.nodes.map((n) => n.san)).toEqual(["e4", "c5", "Nf3"]);
    expect(importRepertoirePgn(book, text)).toEqual(book);
  });
  it("keeps reachable FEN chapters and deduplicates repeated imports", () => {
    const chess = new Chess();
    chess.move("e4");
    const text = `[Event "Chapter"]\n[SetUp "1"]\n[FEN "${chess.fen()}"]\n\n{chapter} 1...Z0 2.Nf3 *\n\n[Event "Main"]\n\n1.e4 e5 *`;
    const book = importRepertoirePgn(base(), text);
    expect(book.nodes.some((n) => n.uci === "@fen")).toBe(false);
    const e4 = book.nodes.find((n) => n.san === "e4")!;
    const waiting = childrenOf(book, e4.id).find((n) => n.uci === "0000")!;
    expect(waiting).toBeDefined();
    expect(book.notes[positionKey(e4.fenAfter)]).toBe("chapter");
    waiting.disabled = true;
    const round = importRepertoirePgn(base(), exportRepertoirePgn(book));
    expect(round.nodes.map((n) => [n.uci, n.fenAfter, n.disabled])).toEqual(
      book.nodes.map((n) => [n.uci, n.fenAfter, n.disabled]),
    );
    expect(round.notes).toEqual(book.notes);
    expect(importRepertoirePgn(book, text).nodes).toEqual(book.nodes);
  });
});
