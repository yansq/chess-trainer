import type {
  GameImport,
  LichessExportGame,
  LichessSyncState,
} from "../../shared/types";

export const SYNC_BATCH_SIZE = 100;
const OVERLAP_MS = 24 * 60 * 60 * 1000;

export const syncStateKey = (username: string) =>
  `lichess_sync_v2:${username.trim().toLowerCase()}`;

export function readSyncState(value: string | null): LichessSyncState {
  if (!value)
    return {
      completedThrough: null,
      pending: null,
      read: 0,
      added: 0,
      unfinishedIds: [],
    };
  const state = JSON.parse(value) as LichessSyncState;
  state.unfinishedIds ??= [];
  const timestamp = (n: unknown) =>
    typeof n === "number" && Number.isSafeInteger(n) && n > 0;
  if (
    (state.completedThrough !== null && !timestamp(state.completedThrough)) ||
    !Number.isSafeInteger(state.read) ||
    state.read < 0 ||
    !Number.isSafeInteger(state.added) ||
    state.added < 0 ||
    !Array.isArray(state.unfinishedIds) ||
    state.unfinishedIds.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9]{8}$/.test(id),
    ) ||
    (state.pending !== null &&
      (!timestamp(state.pending?.until) ||
        !timestamp(state.pending?.upperBound) ||
        state.pending.until > state.pending.upperBound ||
        (state.pending.since !== null &&
          (!timestamp(state.pending.since) ||
            state.pending.since > state.pending.until))))
  )
    throw new Error("同步进度数据无效，未推进同步时间");
  return state;
}

interface SyncDependencies {
  refreshGames: (ids: string[]) => Promise<LichessExportGame[]>;
  getState: () => Promise<LichessSyncState>;
  exportBatch: (
    since: number | null,
    until: number,
  ) => Promise<LichessExportGame[]>;
  parseBatch: (batch: LichessExportGame[]) => Promise<GameImport[]>;
  saveBatch: (
    games: GameImport[],
    state: LichessSyncState,
  ) => Promise<LichessSyncState>;
  onProgress: (state: LichessSyncState) => void;
  shouldPause: () => boolean;
  now: () => number;
}

const isFinished = (game: LichessExportGame) =>
  !["created", "started"].includes(game.status);
function unfinishedIds(state: LichessSyncState, batch: LichessExportGame[]) {
  const ids = new Set(state.unfinishedIds);
  for (const game of batch) {
    if (isFinished(game)) ids.delete(game.id);
    else ids.add(game.id);
  }
  return [...ids];
}

export async function syncAllGames(deps: SyncDependencies) {
  let state = await deps.getState();
  if (!state.pending) {
    const upperBound = deps.now();
    state = await deps.saveBatch([], {
      completedThrough: state.completedThrough,
      pending: {
        since:
          state.completedThrough === null
            ? null
            : Math.max(1, state.completedThrough - OVERLAP_MS),
        until: upperBound,
        upperBound,
      },
      read: 0,
      added: 0,
      unfinishedIds: state.unfinishedIds,
    });
  }
  deps.onProgress(state);
  // Recheck only known ongoing games, including old correspondence games.
  const toRefresh = [...state.unfinishedIds];
  for (
    let offset = 0;
    offset < toRefresh.length && !deps.shouldPause();
    offset += SYNC_BATCH_SIZE
  ) {
    const ids = toRefresh.slice(offset, offset + SYNC_BATCH_SIZE);
    const batch = await deps.refreshGames(ids);
    if (batch.length > ids.length || batch.some((g) => !ids.includes(g.id))) {
      throw new Error("Lichess 返回的待结束对局不匹配，已保留同步进度");
    }
    const games = await deps.parseBatch(batch.filter(isFinished));
    state = await deps.saveBatch(games, {
      ...state,
      read: state.read + batch.length,
      unfinishedIds: unfinishedIds(state, batch),
    });
    deps.onProgress(state);
  }
  while (state.pending && !deps.shouldPause()) {
    const { since, until, upperBound } = state.pending;
    const batch = await deps.exportBatch(since, until);
    if (
      batch.length > SYNC_BATCH_SIZE ||
      batch.some(
        (g, i) =>
          !Number.isSafeInteger(g.createdAt) ||
          g.createdAt > until ||
          (i > 0 && g.createdAt > batch[i - 1].createdAt) ||
          (since !== null && g.createdAt < since),
      )
    )
      throw new Error("Lichess 返回的对局时间范围或排序无效，已保留同步进度");
    const oldest = Math.min(...batch.map((g) => g.createdAt));
    const nextUntil = oldest + 1;
    const complete = batch.length < SYNC_BATCH_SIZE;
    // Lichess treats until as exclusive; overlap the last millisecond so games
    // sharing a timestamp cannot be skipped at a batch boundary.
    if (!complete && nextUntil >= until) {
      throw new Error("同一时间的对局过多，无法安全推进同步；已保留进度");
    }
    const games = await deps.parseBatch(batch.filter(isFinished));
    state = await deps.saveBatch(games, {
      ...state,
      read: state.read + batch.length,
      completedThrough: complete ? upperBound : state.completedThrough,
      pending: complete ? null : { since, until: nextUntil, upperBound },
      unfinishedIds: unfinishedIds(state, batch),
    });
    deps.onProgress(state);
  }
  return state;
}
