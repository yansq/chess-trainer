import { invoke } from "@tauri-apps/api/core";
import type {
  Game,
  GameImport,
  GameFilter,
  GamePage,
  Puzzle,
  Schedule,
  ReviewInput,
  OpeningStat,
  OpponentType,
  LichessExportGame,
  LichessSyncState,
} from "../types";
export interface EngineAnalysis {
  fen: string;
  depth: number;
  scoreType: "cp" | "mate";
  scoreValue: number;
  bestMove: string | null;
  pv: string[];
}
export const api = {
  importGames: (games: GameImport[]) =>
    invoke<number>("import_games", { games }),
  listGames: (filter: GameFilter) => invoke<GamePage>("list_games", { filter }),
  getGame: (id: string) => invoke<Game>("get_game", { id }),
  saveAnnotation: (gameId: string, moveId: string | null, content: string) =>
    invoke<void>("save_annotation", { gameId, moveId, content }),
  getAnnotations: (gameId: string) =>
    invoke<[string | null, string][]>("get_annotations", { gameId }),
  setReviewed: (id: string, reviewed: boolean) =>
    invoke<void>("set_reviewed", { id, reviewed }),
  savePuzzle: (puzzle: Puzzle) => invoke<void>("save_puzzle", { puzzle }),
  listPuzzles: (due: boolean) => invoke<Puzzle[]>("list_puzzles", { due }),
  getSchedule: (id: string) => invoke<Schedule>("get_schedule", { id }),
  recordReview: (input: ReviewInput) =>
    invoke<void>("record_review", { input }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  openingStats: (
    color: string | null,
    speed: string | null,
    from: string | null,
    to: string | null,
    opponentType: OpponentType = "human",
  ) =>
    invoke<OpeningStat[]>("opening_stats", {
      color,
      speed,
      from,
      to,
      opponentType,
    }),
  lichessTest: (username: string) => invoke<void>("lichess_test", { username }),
  lichessExportBatch: (username: string, since: number | null, until: number) =>
    invoke<LichessExportGame[]>("lichess_export_batch", {
      username,
      since,
      until,
    }),
  lichessRefreshGames: (ids: string[]) =>
    invoke<LichessExportGame[]>("lichess_refresh_games", { ids }),
  importSyncBatch: (
    username: string,
    games: GameImport[],
    checkpoint: LichessSyncState,
  ) =>
    invoke<LichessSyncState>("import_sync_batch", {
      username,
      games,
      checkpoint,
    }),
  engineAnalyze: (path: string, fen: string, depth: number) =>
    invoke<EngineAnalysis>("engine_analyze", { path, fen, depth }),
  engineStop: () => invoke<void>("engine_stop"),
  engineValidate: (path: string) => invoke<void>("engine_validate", { path }),
  saveLichessToken: (username: string, token: string) =>
    invoke<void>("save_lichess_token", { username, token }),
};
