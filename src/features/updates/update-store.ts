import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "installed"
  | "error";
export type UpdateHandle = Pick<
  Update,
  "version" | "body" | "download" | "install" | "close"
>;
export interface UpdateDependencies {
  check: () => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
  getVersion: () => Promise<string>;
}
interface UpdateState {
  phase: Phase;
  currentVersion: string;
  version: string;
  notes: string;
  downloaded: number;
  total: number | undefined;
  message: string;
  loadVersion: () => Promise<void>;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  restart: () => Promise<void>;
}
export const updateBusy = (phase: Phase) =>
  ["checking", "downloading", "installing", "restarting"].includes(phase);

// Keep the updater resource and operation alive when the settings page unmounts.
export function createUpdaterStore(deps: UpdateDependencies) {
  let pending: UpdateHandle | null = null;
  let versionRequest: Promise<void> | undefined;
  return create<UpdateState>((set, get) => ({
    phase: "idle",
    currentVersion: "",
    version: "",
    notes: "",
    downloaded: 0,
    total: undefined,
    message: "",
    loadVersion: () => {
      versionRequest ??= deps
        .getVersion()
        .then((currentVersion) => {
          set({ currentVersion });
        })
        .catch(() => {
          versionRequest = undefined;
        });
      return versionRequest;
    },
    checkForUpdate: async () => {
      if (updateBusy(get().phase) || get().phase === "installed") return;
      set({
        phase: "checking",
        message: "正在检查更新…",
        version: "",
        notes: "",
        downloaded: 0,
        total: undefined,
      });
      const previous = pending;
      pending = null;
      try {
        await previous?.close().catch(() => {});
        pending = await deps.check();
        set(
          pending
            ? {
                phase: "available",
                version: pending.version,
                notes: pending.body ?? "",
                message: `发现新版本 ${pending.version}`,
              }
            : { phase: "current", message: "当前已是最新版本" },
        );
      } catch (error) {
        set({ phase: "error", message: `检查更新失败：${String(error)}` });
      }
    },
    installUpdate: async () => {
      if (!pending || get().phase !== "available") return;
      const update = pending;
      set({
        phase: "downloading",
        downloaded: 0,
        total: undefined,
        message: "正在下载更新…",
      });
      try {
        await update.download(
          (event: DownloadEvent) => {
            if (event.event === "Started")
              set({ total: event.data.contentLength });
            if (event.event === "Progress")
              set((state) => ({
                downloaded: state.downloaded + event.data.chunkLength,
              }));
          },
          { timeout: 120_000 },
        );
        set({ phase: "installing", message: "下载完成，正在验证并安装…" });
        await update.install();
        pending = null;
        await update.close().catch(() => {});
        set({ phase: "installed", message: "安装完成，即将重启…" });
        await get().restart();
      } catch (error) {
        pending = null;
        await update.close().catch(() => {});
        set({
          phase: "error",
          message: `更新失败：${String(error)}。可重新检查更新后重试。`,
        });
      }
    },
    restart: async () => {
      if (get().phase !== "installed") return;
      set({ phase: "restarting", message: "正在重启应用…" });
      try {
        await deps.relaunch();
      } catch (error) {
        set({
          phase: "installed",
          message: `新版已安装，重启失败：${String(error)}。请点击重启或手动重新打开应用。`,
        });
      }
    },
  }));
}
export const useUpdater = createUpdaterStore({
  check: () => check({ timeout: 30_000 }),
  relaunch,
  getVersion,
});
