export interface Move {
  id: string;
  gameId: string;
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
}
export interface Game {
  id: string;
  source: string;
  externalGameId: string | null;
  whitePlayer: string;
  blackPlayer: string;
  userColor: "white" | "black" | null;
  result: "white" | "black" | "draw" | "unknown";
  playedAt: string | null;
  timeControl: string | null;
  speed: string | null;
  rated: boolean | null;
  eco: string | null;
  openingName: string | null;
  pgn: string;
  reviewStatus: boolean;
  isBot: boolean;
  moves: Move[];
}
export type GameImport = Omit<Game, "isBot">;
export type OpponentType = "human" | "bot" | "all";
export interface LichessExportGame {
  id: string;
  createdAt: number;
  pgn: string;
  status: string;
}
export interface LichessSyncState {
  completedThrough: number | null;
  pending: {
    since: number | null;
    until: number;
    upperBound: number;
  } | null;
  read: number;
  added: number;
  unfinishedIds: string[];
}
export interface GameFilter {
  opponentType: OpponentType;
  color: string | null;
  result: string | null;
  speed: string | null;
  reviewed: boolean | null;
  opening: string | null;
  limit: number;
  offset: number;
}
export interface GamePage {
  items: Game[];
  total: number;
}
export interface Puzzle {
  id: string;
  sourceType: "manual" | "auto";
  sourceGameId: string | null;
  sourceMoveId: string | null;
  fen: string;
  sideToMove: "white" | "black";
  title: string;
  description: string;
  originalMove: string | null;
  expectedMoves: string[];
  solutionLine: string[];
  errorCategory: string | null;
}
export interface Schedule {
  puzzleId: string;
  dueAt: string;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt: string | null;
  totalAttempts: number;
  correctCount: number;
}
export interface ReviewInput {
  schedule: Schedule;
  playedMove: string | null;
  isCorrect: boolean;
  rating: string;
  timeSpentMs: number;
}
export interface OpeningStat {
  eco: string;
  opening: string;
  total: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  scoreRate: number;
}
