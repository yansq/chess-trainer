import type {
  ChessComGame,
  ChessComSyncState,
  GameImport,
} from "../../shared/types";

export const chessComStateKey = (username: string) =>
  `chesscom_sync_v1:${username.trim().toLowerCase()}`;
const validMonth = (month: unknown): month is string =>
  typeof month === "string" && /^\d{4}\/(0[1-9]|1[0-2])$/.test(month);
export function readChessComState(value: string | null): ChessComSyncState {
  if (!value) return { completedMonths: [], pending: null, read: 0, added: 0 };
  const state = JSON.parse(value) as ChessComSyncState;
  if (
    !Array.isArray(state.completedMonths) ||
    !state.completedMonths.every(validMonth) ||
    (state.pending !== null &&
      (!Array.isArray(state.pending) || !state.pending.every(validMonth))) ||
    !Number.isSafeInteger(state.read) ||
    state.read < 0 ||
    !Number.isSafeInteger(state.added) ||
    state.added < 0
  ) {
    throw new Error("Chess.com 同步进度无效，未推进同步月份");
  }
  return state;
}
interface Dependencies {
  getState: () => Promise<ChessComSyncState>;
  archives: () => Promise<string[]>;
  fetchMonth: (month: string) => Promise<ChessComGame[]>;
  parseBatch: (batch: ChessComGame[]) => Promise<GameImport[]>;
  saveBatch: (
    games: GameImport[],
    state: ChessComSyncState,
  ) => Promise<ChessComSyncState>;
  shouldPause: () => boolean;
  onProgress: (state: ChessComSyncState) => void;
  now: () => number;
}
export async function syncChessComGames(deps: Dependencies) {
  let state = await deps.getState();
  if (state.pending === null) {
    const available = await deps.archives();
    if (!available.every(validMonth)) throw new Error("Chess.com 归档月份无效");
    const now = new Date(deps.now());
    const previous = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const refreshFrom = `${previous.getUTCFullYear()}/${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
    const pending = [...new Set(available)]
      .sort()
      .filter(
        (month) =>
          !state.completedMonths.includes(month) || month >= refreshFrom,
      );
    state = await deps.saveBatch([], { ...state, pending, read: 0, added: 0 });
  }
  deps.onProgress(state);
  while (state.pending?.length && !deps.shouldPause()) {
    const month = state.pending[0];
    const batch = await deps.fetchMonth(month);
    if (
      batch.some(
        (g) =>
          !Number.isSafeInteger(g.end_time) ||
          g.end_time < 0 ||
          new Date(g.end_time * 1000)
            .toISOString()
            .slice(0, 7)
            .replace("-", "/") !== month,
      )
    ) {
      throw new Error("Chess.com 返回的对局月份不一致，已保留同步进度");
    }
    const games = await deps.parseBatch(
      batch.filter((g) => g.rules === "chess"),
    );
    state = await deps.saveBatch(games, {
      ...state,
      completedMonths: [...new Set([...state.completedMonths, month])].sort(),
      pending: state.pending.slice(1),
      read: state.read + batch.length,
    });
    deps.onProgress(state);
  }
  if (!state.pending?.length)
    state = await deps.saveBatch([], { ...state, pending: null });
  return state;
}
