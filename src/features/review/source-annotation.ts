import { Chess } from "chess.js";
import type { Game, Puzzle } from "../../shared/types";

export function findSourceAnnotation(
  puzzle: Puzzle,
  game: Game,
  annotations: [string | null, string][],
): string | null {
  if (puzzle.sourceGameId !== game.id) return null;
  // Auto-created puzzles use the position before their source move. Match the
  // actual position so we never show a note belonging to a different position.
  const move =
    game.moves.find(
      (move) => move.id === puzzle.sourceMoveId && move.fenAfter === puzzle.fen,
    ) ?? game.moves.find((move) => move.fenAfter === puzzle.fen);
  const initialFen = game.moves[0]?.fenBefore ?? new Chess().fen();
  if (!move && puzzle.fen !== initialFen) return null;
  const content = annotations.find(([id]) => id === (move?.id ?? null))?.[1];
  return content?.trim() ? content : null;
}
