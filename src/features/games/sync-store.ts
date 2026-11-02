import { create } from "zustand";
import { api } from "../../shared/api";
import type {
  ChessComGame,
  GameImport,
  LichessExportGame,
} from "../../shared/types";
import { readSyncState, syncAllGames, syncStateKey } from "./sync";
import {
  chessComStateKey,
  readChessComState,
  syncChessComGames,
} from "./chesscom-sync";

interface SyncStore {
  running: boolean;
  pausing: boolean;
  message: string;
  pending: boolean;
  revision: number;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => void;
}

export const useGameSync = create<SyncStore>((set, get) => ({
  running: false,
  pausing: false,
  message: "",
  pending: false,
  revision: 0,
  refresh: async () => {
    if (get().running) return;
    try {
      const [lichess, chesscom] = await Promise.all([
        api.getSetting("lichess_username"),
        api.getSetting("chesscom_username"),
      ]);
      const [left, right] = await Promise.all([
        lichess ? api.getSetting(syncStateKey(lichess)) : null,
        chesscom ? api.getSetting(chessComStateKey(chesscom)) : null,
      ]);
      const pending =
        !!readSyncState(left).pending ||
        readChessComState(right).pending !== null;
      if (!get().running) set({ pending });
    } catch (error) {
      if (!get().running) set({ message: String(error) });
    }
  },
  pause: () => set({ pausing: true }),
  start: async () => {
    if (get().running) return;
    set({ running: true, pausing: false, message: "正在准备同步…" });
    const messages = new Map<string, string>();
    const report = (platform: string, message: string) => {
      messages.set(platform, `${platform}：${message}`);
      set({ message: [...messages.values()].join("；") });
    };
    const refreshList = () =>
      set((state) => ({ revision: state.revision + 1 }));
    async function syncPlatform(
      platform: "Lichess" | "Chess.com",
      username: string,
    ) {
      const worker = new Worker(new URL("./pgn.worker.ts", import.meta.url), {
        type: "module",
      });
      function parseBatch(batch: LichessExportGame[] | ChessComGame[]) {
        return new Promise<GameImport[]>((resolve, reject) => {
          worker.onmessage = (
            event: MessageEvent<{ games: GameImport[]; error?: string }>,
          ) => {
            if (event.data.error) reject(new Error(event.data.error));
            else resolve(event.data.games);
          };
          worker.onerror = (event) =>
            reject(new Error(event.message || "棋谱解析线程异常"));
          worker.postMessage({
            source: platform === "Lichess" ? "lichess" : "chesscom",
            batch,
            username,
          });
        });
      }
      try {
        const common = {
          parseBatch,
          shouldPause: () => get().pausing,
          now: () => Date.now(),
          onProgress: (state: { read: number; added: number }) =>
            report(platform, `已读取 ${state.read} 局，新增 ${state.added} 局`),
        };
        const checkpoint =
          platform === "Lichess"
            ? await syncAllGames({
                ...common,
                getState: async () =>
                  readSyncState(await api.getSetting(syncStateKey(username))),
                exportBatch: (since, until) =>
                  api.lichessExportBatch(username, since, until),
                refreshGames: (ids) => api.lichessRefreshGames(ids),
                saveBatch: async (games, state) => {
                  const result = await api.importSyncBatch(
                    username,
                    games,
                    state,
                  );
                  refreshList();
                  return result;
                },
              })
            : await syncChessComGames({
                ...common,
                getState: async () =>
                  readChessComState(
                    await api.getSetting(chessComStateKey(username)),
                  ),
                archives: () => api.chessComArchives(username),
                fetchMonth: (month) => api.chessComMonth(username, month),
                saveBatch: async (games, state) => {
                  const result = await api.importChessComBatch(
                    username,
                    games,
                    state,
                  );
                  refreshList();
                  return result;
                },
              });
        report(
          platform,
          `${checkpoint.pending !== null ? "已暂停" : "同步完成"}，读取 ${checkpoint.read} 局，新增 ${checkpoint.added} 局`,
        );
      } catch (error) {
        report(
          platform,
          `同步未完成，${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        worker.terminate();
      }
    }
    try {
      const [lichess, chesscom] = await Promise.all([
        api.getSetting("lichess_username"),
        api.getSetting("chesscom_username"),
      ]);
      if (!lichess?.trim() && !chesscom?.trim())
        throw new Error("请先在设置中填写 Lichess 或 Chess.com 用户名");
      const jobs: Promise<void>[] = [];
      for (const [platform, username] of [
        ["Lichess", lichess],
        ["Chess.com", chesscom],
      ] as const) {
        if (!username?.trim()) continue;
        report(platform, "正在准备同步…");
        jobs.push(
          syncPlatform(platform, username.trim()).catch((error) => {
            report(
              platform,
              `同步未完成，${error instanceof Error ? error.message : String(error)}`,
            );
          }),
        );
      }
      await Promise.allSettled(jobs);
    } catch (error) {
      set({ message: String(error) });
    } finally {
      set((state) => ({
        running: false,
        pausing: false,
        revision: state.revision + 1,
      }));
      await get().refresh();
    }
  },
}));
