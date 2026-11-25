import { create } from "zustand";
import { api } from "../../shared/api";
import type { BackupCounts, BackupInspection } from "../../shared/types";
import { useGameSync } from "../games/sync-store";
import {
  applyClientPreferences,
  readClientPreferences,
} from "./backup-preferences";

export const MAX_BACKUP_FILE_BYTES = 256 * 1024 * 1024;

export interface BackupFeedback {
  status: "success" | "error" | "info";
  text: string;
}

export type BackupState =
  | { kind: "idle"; feedback: BackupFeedback | null }
  | { kind: "exporting"; feedback: BackupFeedback | null }
  | { kind: "inspecting"; fileName: string }
  | {
      kind: "confirming";
      fileName: string;
      rawJson: string;
      inspection: BackupInspection;
      exportingSafetyCopy: boolean;
      safetyFeedback: BackupFeedback | null;
    }
  | { kind: "importing"; fileName: string; inspection: BackupInspection };

export interface BackupStore {
  state: BackupState;
  exportCurrent: () => Promise<void>;
  stageFile: (file: File) => Promise<void>;
  cancelImport: () => void;
  confirmImport: (onDatabaseRestored?: () => Promise<void>) => Promise<void>;
}

export function isBackupBusy(state: BackupState): boolean {
  return (
    state.kind === "exporting" ||
    state.kind === "inspecting" ||
    state.kind === "importing" ||
    (state.kind === "confirming" && state.exportingSafetyCopy)
  );
}

export function hasBackupUserData(counts: BackupCounts): boolean {
  return (
    counts.games > 0 ||
    counts.annotations > 0 ||
    counts.reviewVariations > 0 ||
    counts.puzzles > 0 ||
    counts.reviewLogs > 0 ||
    counts.repertoires > 0 ||
    counts.settings > 0
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSummaryCounts(counts: BackupCounts): string {
  return `${counts.games} 局对局、${counts.puzzles} 道题目、${counts.repertoires} 个开局库`;
}

function applyExportOutcome(
  set: (partial: Partial<BackupStore>) => void,
  get: () => BackupStore,
  inConfirmDialog: boolean,
  feedback: BackupFeedback,
): void {
  const latest = get().state;
  if (inConfirmDialog && latest.kind === "confirming") {
    set({
      state: {
        ...latest,
        exportingSafetyCopy: false,
        safetyFeedback: feedback,
      },
    });
    return;
  }
  set({ state: { kind: "idle", feedback } });
}

export const useBackup = create<BackupStore>((set, get) => ({
  state: { kind: "idle", feedback: null },
  exportCurrent: async () => {
    const current = get().state;
    if (isBackupBusy(current)) return;
    if (useGameSync.getState().running) {
      applyExportOutcome(set, get, current.kind === "confirming", {
        status: "error",
        text: "正在同步对局，请先暂停或等待同步完成后再导出",
      });
      return;
    }

    const inConfirmDialog = current.kind === "confirming";
    if (current.kind === "confirming") {
      set({
        state: {
          ...current,
          exportingSafetyCopy: true,
          safetyFeedback: null,
        },
      });
    } else {
      set({ state: { kind: "exporting", feedback: null } });
    }

    const sync = useGameSync.getState();
    const alreadyBlocked = sync.maintenanceBlocked;
    if (!alreadyBlocked) sync.setMaintenanceBlocked(true);

    try {
      const exported = await api.exportBackup(readClientPreferences());
      applyExportOutcome(set, get, inConfirmDialog, {
        status: "success",
        text: `已导出备份至：${exported.savedPath}（${formatSummaryCounts(exported.counts)}）`,
      });
    } catch (error) {
      applyExportOutcome(set, get, inConfirmDialog, {
        status: "error",
        text: `导出备份失败：${errorMessage(error)}`,
      });
    } finally {
      if (!alreadyBlocked) {
        useGameSync.getState().setMaintenanceBlocked(false);
      }
    }
  },
  stageFile: async (file) => {
    if (isBackupBusy(get().state)) return;
    if (useGameSync.getState().running) {
      set({
        state: {
          kind: "idle",
          feedback: {
            status: "error",
            text: "正在同步对局，请先暂停或等待同步完成后再导入",
          },
        },
      });
      return;
    }
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      set({
        state: {
          kind: "idle",
          feedback: {
            status: "error",
            text: "备份文件超过 256 MB 上限",
          },
        },
      });
      return;
    }

    set({ state: { kind: "inspecting", fileName: file.name } });
    try {
      const rawJson = await file.text();
      const inspection = await api.inspectBackup(rawJson);
      set({
        state: {
          kind: "confirming",
          fileName: file.name,
          rawJson,
          inspection,
          exportingSafetyCopy: false,
          safetyFeedback: null,
        },
      });
    } catch (error) {
      set({
        state: {
          kind: "idle",
          feedback: {
            status: "error",
            text: `备份检查失败：${errorMessage(error)}`,
          },
        },
      });
    }
  },
  cancelImport: () => {
    const current = get().state;
    if (current.kind === "confirming" && !current.exportingSafetyCopy) {
      set({ state: { kind: "idle", feedback: null } });
    }
  },
  confirmImport: async (onDatabaseRestored) => {
    const current = get().state;
    if (current.kind !== "confirming" || current.exportingSafetyCopy) return;
    if (useGameSync.getState().running) {
      set({
        state: {
          ...current,
          safetyFeedback: {
            status: "error",
            text: "正在同步对局，请先暂停或等待同步完成后再恢复",
          },
        },
      });
      return;
    }

    set({
      state: {
        kind: "importing",
        fileName: current.fileName,
        inspection: current.inspection,
      },
    });
    useGameSync.getState().setMaintenanceBlocked(true);

    try {
      const result = await api.importBackup(current.rawJson);
      applyClientPreferences(result.clientPreferences);
      await useGameSync.getState().onBackupRestored();
      await onDatabaseRestored?.();

      const hasTokenNotice = result.warnings.some(
        (w) => w.code === "lichessTokenNotIncluded",
      );
      const suffix = hasTokenNotice
        ? "；Lichess Token 需在下方重新填写"
        : "";
      set({
        state: {
          kind: "idle",
          feedback: {
            status: "success",
            text: `已从 ${current.fileName} 恢复数据（${formatSummaryCounts(result.restoredCounts)}）${suffix}`,
          },
        },
      });
    } catch (error) {
      set({
        state: {
          kind: "idle",
          feedback: {
            status: "error",
            text: `备份恢复失败：${errorMessage(error)}`,
          },
        },
      });
    } finally {
      useGameSync.getState().setMaintenanceBlocked(false);
    }
  },
}));
