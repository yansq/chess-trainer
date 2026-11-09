import { Chess } from "chess.js";
import { parseGames } from "@mliebelt/pgn-parser";
import { tryMove } from "../../shared/chess/moves";

export interface RepertoireNode {
  id: string;
  parentId: string | null;
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
  order: number;
  disabled: boolean;
  nags: string[];
}
export interface Repertoire {
  id: string;
  name: string;
  side: "white" | "black";
  initialFen: string;
  nodes: RepertoireNode[];
  notes: Record<string, string>;
  revision: number;
}
export interface RepertoireSummary {
  id: string;
  name: string;
  side: "white" | "black";
  count: number;
  revision: number;
}
export const positionKey = (fen: string) =>
  fen.split(/\s+/).slice(0, 4).join(" ");
export function newRepertoire(
  name: string,
  side: "white" | "black",
  fen = new Chess().fen(),
): Repertoire {
  const chess = new Chess(fen);
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    side,
    initialFen: chess.fen(),
    nodes: [],
    notes: {},
    revision: 0,
  };
}
export const childrenOf = (book: Repertoire, parentId: string | null) =>
  book.nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
export function addMove(
  book: Repertoire,
  parentId: string | null,
  from: string,
  to: string,
  promotion = "q",
) {
  const parent =
    parentId === null ? null : book.nodes.find((n) => n.id === parentId);
  if (parentId !== null && !parent) throw Error("招法起点不存在");
  const fenBefore = parent?.fenAfter ?? book.initialFen;
  const move = tryMove(fenBefore, from, to, promotion);
  if (!move) throw Error("该招法不合法");
  const existing = childrenOf(book, parentId).find((n) => n.uci === move.uci);
  if (existing) return { book, node: existing };
  if (book.nodes.length >= 50000)
    throw Error("单个开局库最多支持 50000 个招法，请拆分为多个库");
  const node: RepertoireNode = {
    id: crypto.randomUUID(),
    parentId,
    uci: move.uci,
    san: move.san,
    fenBefore,
    fenAfter: move.fen,
    order: Math.max(-1, ...childrenOf(book, parentId).map((n) => n.order)) + 1,
    disabled: false,
    nags: [],
  };
  return { book: { ...book, nodes: [...book.nodes, node] }, node };
}
export function pathTo(book: Repertoire, id: string | null) {
  const path: RepertoireNode[] = [];
  const map = new Map(book.nodes.map((n) => [n.id, n]));
  let node = id ? map.get(id) : undefined;
  while (node) {
    path.unshift(node);
    node = node.parentId ? map.get(node.parentId) : undefined;
  }
  return path;
}
export const moveLabel = (node: RepertoireNode) =>
  node.uci === "@fen"
    ? `${node.san} · 第 ${node.fenAfter.split(" ")[5]} 回合`
    : `${node.fenBefore.split(" ")[5]}${node.fenBefore.split(" ")[1] === "w" ? "." : "…"} ${node.san}`;
export function deleteBranch(book: Repertoire, id: string) {
  const removed = new Set([id]);
  for (const node of book.nodes)
    if (node.parentId && removed.has(node.parentId)) removed.add(node.id);
  const nodes = book.nodes.filter((n) => !removed.has(n.id));
  const retained = new Set([
    positionKey(book.initialFen),
    ...nodes.map((n) => positionKey(n.fenAfter)),
  ]);
  return {
    ...book,
    nodes,
    notes: Object.fromEntries(
      Object.entries(book.notes).filter(([key]) => retained.has(key)),
    ),
  };
}
export function promoteNode(book: Repertoire, id: string) {
  const node = book.nodes.find((n) => n.id === id);
  if (!node) return book;
  const siblings = childrenOf(book, node.parentId);
  const order = Math.min(...siblings.map((n) => n.order)) - 1;
  return {
    ...book,
    nodes: book.nodes.map((n) => (n.id === id ? { ...n, order } : n)),
  };
}
function parsedComment(text: string | undefined, details: unknown) {
  const metadata = details as Record<string, unknown> | null;
  const encoded =
    typeof metadata?.ct_note === "string"
      ? ` [%ct_note ${metadata.ct_note}]`
      : "";
  const disabled = metadata?.ct_disabled === "1" ? " [%ct_disabled 1]" : "";
  return (text ?? "") + encoded + disabled;
}
function mergeNote(book: Repertoire, fen: string, comment: string | undefined) {
  if (!comment?.trim()) return;
  const encoded = comment.match(/\[%ct_note ([^\]]+)\]/)?.[1];
  let text = comment
    .replace(/\[%ct_disabled 1\]/g, "")
    .replace(/\[%ct_note [^\]]+\]/g, "")
    .trim();
  if (encoded) {
    try {
      text = decodeURIComponent(encoded);
    } catch {
      throw Error("PGN 评注编码无效");
    }
  }
  if (!text) return;
  const key = positionKey(fen),
    prior = book.notes[key] ?? "";
  const separator = "\n\n---\n\n";
  book.notes[key] = [
    ...new Set([
      ...(prior ? prior.split(separator) : []),
      ...text.split(separator),
    ]),
  ].join(separator);
}
export function importRepertoirePgn(original: Repertoire, text: string) {
  if (text.length > 10_000_000) throw Error("PGN 超过 10 MB，请拆分导入");
  const games = parseGames(text.trim());
  if (!games.length) throw Error("PGN 中没有棋谱");
  const book = structuredClone(original);
  const nodes = new Map(book.nodes.map((n) => [n.id, n]));
  const edgeKey = (parent: string | null, uci: string, fen = "") =>
    JSON.stringify([parent, uci, uci === "@fen" ? positionKey(fen) : ""]);
  const edges = new Map(
    book.nodes.map((n) => [edgeKey(n.parentId, n.uci, n.fenAfter), n]),
  );
  const orders = new Map<string | null, number>();
  for (const n of book.nodes)
    orders.set(n.parentId, Math.max(orders.get(n.parentId) ?? -1, n.order));
  function append(
    parentId: string | null,
    uci: string,
    san: string,
    before: string,
    after: string,
  ) {
    const key = edgeKey(parentId, uci, after),
      existing = edges.get(key);
    if (existing) return existing;
    if (book.nodes.length >= 50000)
      throw Error("单个开局库最多支持 50000 个招法，请拆分导入");
    const order = (orders.get(parentId) ?? -1) + 1;
    orders.set(parentId, order);
    const node: RepertoireNode = {
      id: crypto.randomUUID(),
      parentId,
      uci,
      san,
      fenBefore: before,
      fenAfter: after,
      order,
      disabled: false,
      nags: [],
    };
    nodes.set(node.id, node);
    edges.set(key, node);
    book.nodes.push(node);
    if (reachable && !reachable.has(positionKey(after)))
      reachable.set(positionKey(after), node.id);
    return node;
  }
  let processed = 0;
  const chapters = games.map((game, index) => {
    const fen = new Chess(
      typeof game.tags?.FEN === "string" ? game.tags.FEN : undefined,
    ).fen();
    return {
      game,
      index,
      fen,
      fromInitial: positionKey(fen) === positionKey(book.initialFen),
    };
  });
  // Import full lines first so chapter order cannot affect FEN filtering.
  chapters.sort((a, b) => Number(b.fromInitial) - Number(a.fromInitial));
  let reachable: Map<string, string | null> | undefined;
  let pendingChapters = chapters;
  while (pendingChapters.length) {
    const deferred: typeof chapters = [];
    const previousCount = book.nodes.length;
    for (const chapter of pendingChapters) {
      const { game, index, fen, fromInitial } = chapter;
      const variant = game.tags?.Variant;
      if (variant && String(variant).toLowerCase() !== "standard")
        throw Error(`第 ${index + 1} 盘不是标准国际象棋`);
      if (!fromInitial) {
        if (!reachable) {
          const children = new Map<string | null, RepertoireNode[]>();
          for (const node of book.nodes) {
            const list = children.get(node.parentId) ?? [];
            list.push(node);
            children.set(node.parentId, list);
          }
          reachable = new Map([[positionKey(book.initialFen), null]]);
          const rooted = new Set<string>();
          const pending = [...(children.get(null) ?? [])];
          while (pending.length) {
            const node = pending.pop()!;
            if (node.uci === "@fen") continue;
            rooted.add(node.id);
            pending.push(...(children.get(node.id) ?? []));
          }
          // Use one stable full route per position rather than duplicating a
          // chapter across transpositions (or multiplying it on re-import).
          for (const node of book.nodes) {
            const key = positionKey(node.fenAfter);
            if (rooted.has(node.id) && !reachable.has(key))
              reachable.set(key, node.id);
          }
        }
        if (!reachable.has(positionKey(fen))) {
          deferred.push(chapter);
          continue;
        }
      }
      const root = fromInitial ? null : reachable!.get(positionKey(fen))!;
      const tags = game.tags as Record<string, unknown> | undefined;
      mergeNote(
        book,
        fen,
        parsedComment(game.gameComment?.comment, game.gameComment),
      );
      function line(
        moves: typeof game.moves,
        parentId: string | null,
        depth: number,
        disableFirst = false,
      ) {
        if (depth > 128) throw Error("PGN 分支嵌套过深");
        let first = true;
        for (const move of moves) {
          if (++processed > 250000) throw Error("PGN 招法过多，请拆分导入");
          const before = parentId
            ? nodes.get(parentId)!.fenAfter
            : book.initialFen;
          const chess = new Chess(before);
          const nullMove = ["Z0", "--", "0000", "@@"].includes(
            move.notation.notation,
          );
          let played;
          try {
            played = chess.move(nullMove ? null : move.notation.notation);
          } catch {
            throw Error(
              `第 ${index + 1} 盘「${move.moveNumber ?? ""}${move.notation.notation}」在当前局面不合法`,
            );
          }
          const node = append(
            parentId,
            nullMove
              ? "0000"
              : `${played.from}${played.to}${played.promotion ?? ""}`,
            nullMove ? "--" : played.san,
            before,
            chess.fen(),
          );
          const comment = parsedComment(move.commentAfter, move.commentDiag);
          node.disabled ||=
            (first && disableFirst) || comment.includes("[%ct_disabled 1]");
          node.nags = [...new Set([...node.nags, ...(move.nag ?? [])])];
          mergeNote(book, node.fenAfter, comment);
          for (const branch of move.variations ?? [])
            line(branch, parentId, depth + 1, first && disableFirst);
          first = false;
          parentId = node.id;
        }
      }
      line(game.moves, root, 0, !fromInitial && tags?.CTDisabled === "1");
    }
    if (book.nodes.length === previousCount) break;
    pendingChapters = deferred;
  }
  return book;
}
export function exportRepertoirePgn(book: Repertoire) {
  const tag = (s: string) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/[\r\n]/g, " ");
  const written = new Set<string>();
  function comment(fen: string, disabled = false) {
    const key = positionKey(fen),
      text = written.has(key) ? "" : (book.notes[key] ?? "");
    written.add(key);
    const parts = [
      disabled ? "[%ct_disabled 1]" : "",
      text
        ? `${text.replace(/[{}]/g, " ").replace(/\n/g, " ")} [%ct_note ${encodeURIComponent(text)}]`
        : "",
    ].filter(Boolean);
    return parts.length ? ` {${parts.join(" ")}}` : "";
  }
  const children = new Map<string | null, RepertoireNode[]>();
  for (const node of book.nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const render = (n: RepertoireNode) =>
    `${moveLabel(n).replace("…", "...")}${n.nags.length ? ` ${n.nags.join(" ")}` : ""}${comment(n.fenAfter, n.disabled)}`;
  function choices(list: RepertoireNode[], depth = 0): string {
    if (depth > 128) throw Error("PGN 分支嵌套过深");
    const chunks: string[] = [];
    while (list.length) {
      const first = list[0];
      chunks.push(render(first));
      for (const alt of list.slice(1))
        chunks.push(
          `(${render(alt)} ${choices(children.get(alt.id) ?? [], depth + 1)})`,
        );
      list = children.get(first.id) ?? [];
    }
    return chunks.join(" ");
  }
  function game(fen: string, roots: RepertoireNode[], setup?: RepertoireNode) {
    const metadata = setup
      ? `\n[CTRootName "${tag(setup.san)}"]${setup.disabled ? '\n[CTDisabled "1"]' : ""}`
      : "";
    return `[Event "${tag(book.name)}"]\n[Result "*"]\n[SetUp "1"]\n[FEN "${fen}"]${metadata}\n\n${comment(fen).trim()} ${choices(roots)} *\n`;
  }
  const roots = children.get(null) ?? [];
  return [
    game(
      book.initialFen,
      roots.filter((n) => n.uci !== "@fen"),
    ),
    ...roots
      .filter((n) => n.uci === "@fen")
      .map((n) => game(n.fenAfter, children.get(n.id) ?? [], n)),
  ].join("\n");
}
