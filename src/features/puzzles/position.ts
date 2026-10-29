import { Chess, validateFen, type Square } from "chess.js";
import type { PositionDataType } from "react-chessboard";

export type PositionDraft = {
  pieces: PositionDataType;
  turn: "w" | "b";
  castling: string;
  enPassant: string;
  halfmove: string;
  fullmove: string;
};
export const CASTLING = [
  { right: "K", king: "e1", rook: "h1", color: "w", label: "白方 O-O" },
  { right: "Q", king: "e1", rook: "a1", color: "w", label: "白方 O-O-O" },
  { right: "k", king: "e8", rook: "h8", color: "b", label: "黑方 O-O" },
  { right: "q", king: "e8", rook: "a8", color: "b", label: "黑方 O-O-O" },
] as const;

export function positionFromFen(fen: string): PositionDraft {
  const error = positionError(fen);
  if (error) throw new Error(error);
  const chess = new Chess(fen.trim());
  const [, turn, castling, enPassant, halfmove, fullmove] = fen
    .trim()
    .split(/\s+/);
  const pieces: PositionDataType = {};
  for (const row of chess.board())
    for (const piece of row)
      if (piece)
        pieces[piece.square] = {
          pieceType: piece.color + piece.type.toUpperCase(),
        };
  return {
    pieces,
    turn: turn as "w" | "b",
    castling: castling === "-" ? "" : castling,
    enPassant,
    halfmove,
    fullmove,
  };
}

export function positionFen(draft: PositionDraft): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = "";
    let empty = 0;
    for (const file of "abcdefgh") {
      const piece = draft.pieces[`${file}${rank}`]?.pieceType;
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += piece[0] === "w" ? piece[1] : piece[1].toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join("/")} ${draft.turn} ${draft.castling || "-"} ${draft.enPassant} ${draft.halfmove} ${draft.fullmove}`;
}

export function canCastle(
  pieces: PositionDataType,
  option: (typeof CASTLING)[number],
) {
  return (
    pieces[option.king]?.pieceType === `${option.color}K` &&
    pieces[option.rook]?.pieceType === `${option.color}R`
  );
}

export function placePiece(
  draft: PositionDraft,
  square: string,
  piece: string | null,
  from?: string,
): PositionDraft {
  const pieces = { ...draft.pieces };
  if (from) delete pieces[from];
  if (piece) pieces[square] = { pieceType: piece };
  else delete pieces[square];
  return {
    ...draft,
    pieces,
    castling: CASTLING.filter(
      (option) =>
        draft.castling.includes(option.right) && canCastle(pieces, option),
    )
      .map((option) => option.right)
      .join(""),
    enPassant: "-",
    halfmove: "0",
  };
}

export function positionError(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6)
    return "FEN 需要包含棋子布局、走棋方、易位权、吃过路兵格及两个回合计数，共六部分。";
  const validation = validateFen(fields.join(" "));
  if (!validation.ok) {
    const error = validation.error ?? "";
    if (/king/i.test(error)) return "局面必须包含且仅包含一个白王和一个黑王。";
    if (/pawn/i.test(error)) return "兵不能放在第一横线或第八横线。";
    if (/en.passant/i.test(error)) return "吃过路兵格与走棋方不匹配。";
    return "FEN 格式无效，请检查棋子布局、走棋方、易位权和回合计数。";
  }
  const chess = new Chess(fields.join(" "));
  const turn = chess.turn();
  const opponentKing = chess
    .board()
    .flat()
    .find((p) => p?.type === "k" && p.color !== turn)!;
  if (chess.isAttacked(opponentKing.square, turn))
    return "未轮到走棋的一方不能处于被将军状态，请调整局面或走棋方。";
  for (const option of CASTLING) {
    if (
      fields[2].includes(option.right) &&
      (chess.get(option.king)?.type !== "k" ||
        chess.get(option.king)?.color !== option.color ||
        chess.get(option.rook)?.type !== "r" ||
        chess.get(option.rook)?.color !== option.color)
    )
      return "易位权需要对应的王和车都在初始格。";
  }
  if (fields[3] !== "-") {
    const pawnSquare = fields[3][0] + (turn === "w" ? "5" : "4");
    const originSquare = fields[3][0] + (turn === "w" ? "7" : "2");
    if (
      chess.get(fields[3] as Square) ||
      chess.get(originSquare as Square) ||
      chess.get(pawnSquare as Square)?.type !== "p" ||
      chess.get(pawnSquare as Square)?.color === turn
    )
      return "吃过路兵格需要对应刚走两格的对方兵，目标格和原始格应为空。";
  }
  return "";
}
