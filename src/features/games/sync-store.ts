import { create } from "zustand";
import { api } from "../../shared/api";
import type { GameImport, LichessSyncState } from "../../shared/types";
import { readSyncState, syncAllGames, syncStateKey } from "./sync";

interface SyncStore {
  running: boolean;
  pausing: boolean;
  message: string;
  checkpoint: LichessSyncState | null;
  revision: number;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => void;
}

export const useLichessSync = create<SyncStore>((set, get) => ({
  running: false,
  pausing: false,
  message: "",
  checkpoint: null,
  revision: 0,
  refresh: async () => {
    if (get().running) return;
    try {
      const username = await api.getSetting("lichess_username");
      const checkpoint = readSyncState(
        username ? await api.getSetting(syncStateKey(username)) : null,
      );
      if (!get().running) set({ checkpoint });
    } catch (error) {
      if (!get().running) set({ message: String(error) });
    }
  },
  pause: () => set({ pausing: true }),
  start: async () => {
    if (get().running) return;
    set({ running: true, pausing: false, message: "正在准备同步…" });
    let worker: Worker | undefined;
    try {
      const username = await api.getSetting("lichess_username");
      if (!username) throw new Error("请先在设置中填写 Lichess 用户名");
      worker = new Worker(new URL("./pgn.worker.ts", import.meta.url), {
        type: "module",
      });
      const parser = worker;
      const checkpoint = await syncAllGames({
        getState: async () =>
          readSyncState(await api.getSetting(syncStateKey(username))),
        exportBatch: (since, until) =>
          api.lichessExportBatch(username, since, until),
        refreshGames: (ids) => api.lichessRefreshGames(ids),
        parseBatch: (batch) =>
          new Promise<GameImport[]>((resolve, reject) => {
            parser.onmessage = (
              event: MessageEvent<{ games: GameImport[]; error?: string }>,
            ) => {
              if (event.data.error) reject(new Error(event.data.error));
              else resolve(event.data.games);
            };
            parser.onerror = (event) =>
              reject(new Error(event.message || "棋谱解析线程异常"));
            parser.postMessage({ batch, username });
          }),
        saveBatch: (games, state) =>
          api.importSyncBatch(username, games, state),
        onProgress: (checkpoint) =>
          set({
            checkpoint,
            message: `同步中：已读取 ${checkpoint.read} 局，新增 ${checkpoint.added} 局`,
          }),
        shouldPause: () => get().pausing,
        now: () => Date.now(),
      });
      set({
        message: `${checkpoint.pending ? "同步已暂停" : "同步完成"}：读取 ${checkpoint.read} 局，新增 ${checkpoint.added} 局`,
      });
    } catch (error) {
      set({
        message: `同步未完成：${error}。请重试。`,
      });
    } finally {
      worker?.terminate();
      set((state) => ({
        running: false,
        pausing: false,
        revision: state.revision + 1,
      }));
    }
  },
}));
