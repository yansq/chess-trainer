import { Chess, type Square } from "chess.js";
export function tryMove(
  fen: string,
  from: string,
  to: string,
  promotion = "q",
): { uci: string; san: string; fen: string } | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: from as Square,
      to: to as Square,
      promotion,
    });
    return move
      ? {
          uci: `${move.from}${move.to}${move.promotion ?? ""}`,
          san: move.san,
          fen: chess.fen(),
        }
      : null;
  } catch {
    return null;
  }
}
export function normalizeAnswer(fen: string, answer: string): string | null {
  try {
    const chess = new Chess(fen);
    const move = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(answer)
      ? chess.move({
          from: answer.slice(0, 2) as Square,
          to: answer.slice(2, 4) as Square,
          promotion: answer[4] ?? "q",
        })
      : chess.move(answer);
    return move ? `${move.from}${move.to}${move.promotion ?? ""}` : null;
  } catch {
    return null;
  }
}
