import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BackupCounts,
  BackupExport,
  BackupInspection,
  BackupRestoreResult,
  ClientPreferences,
} from "../src/shared/types";

const mockApi = vi.hoisted(() => ({
  getSetting: vi.fn(),
  exportBackup: vi.fn(),
  inspectBackup: vi.fn(),
  importBackup: vi.fn(),
}));

vi.mock("../src/shared/api", () => ({ api: mockApi }));

import { useGameSync } from "../src/features/games/sync-store";
import {
  applyClientPreferences,
  readClientPreferences,
} from "../src/features/settings/backup-preferences";
import {
  MAX_BACKUP_FILE_BYTES,
  useBackup,
} from "../src/features/settings/backup-store";
import { useSoundSettings } from "../src/shared/audio/settings";
import { useAppearanceStore } from "../src/shared/ui/AppTheme";
import { useSidebarPreference } from "../src/shared/ui/sidebar";

function makeCounts(overrides: Partial<BackupCounts> = {}): BackupCounts {
  return {
    games: 2,
    moves: 40,
    annotations: 3,
    reviewVariations: 1,
    puzzles: 5,
    reviewSchedules: 5,
    reviewLogs: 12,
    repertoires: 1,
    settings: 4,
    ...overrides,
  };
}

function makeInspection(
  overrides: Partial<BackupInspection> = {},
): BackupInspection {
  return {
    formatVersion: 1,
    dbSchemaVersion: 9,
    appVersion: "0.2.0",
    exportedAt: "2026-11-20T06:00:00Z",
    backupCounts: makeCounts(),
    currentCounts: makeCounts({ games: 1, moves: 10 }),
    hasClientPreferences: true,
    warnings: [
      {
        code: "overwritesExistingData",
        message: "恢复将覆盖当前本地数据",
      },
    ],
    ...overrides,
  };
}

function makeFile(content: string, name = "backup.json", size?: number): File {
  const file = new File([content], name, { type: "application/json" });
  if (size !== undefined) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
}

beforeEach(() => {
  vi.resetAllMocks();
  useAppearanceStore.setState({ appearance: "dark" });
  useSidebarPreference.setState({ collapsed: false });
  useSoundSettings.setState({ enabled: true, volume: 70 });
  useGameSync.setState({
    running: false,
    pausing: false,
    maintenanceBlocked: false,
    message: "",
    pending: false,
    revision: 0,
  });
  useBackup.setState({ state: { kind: "idle", feedback: null } });

  mockApi.getSetting.mockResolvedValue(null);
});

describe("backup store and preferences", () => {
  it("exports backup with live preferences and blocks concurrent sync during export", async () => {
    useAppearanceStore.getState().setAppearance("light");
    useSidebarPreference.getState().setCollapsed(true);
    useSoundSettings.getState().apply({ enabled: false, volume: 35 });

    const exportedPath = "/tmp/backups/chess-trainer-backup-20261120-060000Z.json";
    let blockedDuringExport = false;
    mockApi.exportBackup.mockImplementation(
      async (): Promise<BackupExport> => {
        blockedDuringExport = useGameSync.getState().maintenanceBlocked;
        await useGameSync.getState().start();
        expect(useGameSync.getState().running).toBe(false);
        return {
          filename: "chess-trainer-backup-20261120-060000Z.json",
          savedPath: exportedPath,
          exportedAt: "2026-11-20T06:00:00Z",
          formatVersion: 1,
          dbSchemaVersion: 9,
          counts: makeCounts(),
        };
      },
    );

    await useBackup.getState().exportCurrent();

    expect(blockedDuringExport).toBe(true);
    expect(useGameSync.getState().maintenanceBlocked).toBe(false);
    expect(mockApi.exportBackup).toHaveBeenCalledWith({
      appearance: "light",
      sidebarCollapsed: true,
      sound: { enabled: false, volume: 35 },
    });
    expect(useBackup.getState().state).toMatchObject({
      kind: "idle",
      feedback: {
        status: "success",
        text: expect.stringContaining(exportedPath),
      },
    });
  });

  it("rejects export and stageFile while game sync is running", async () => {
    useGameSync.setState({ running: true });

    await useBackup.getState().exportCurrent();
    expect(mockApi.exportBackup).not.toHaveBeenCalled();
    expect(useBackup.getState().state).toMatchObject({
      kind: "idle",
      feedback: { status: "error" },
    });

    await useBackup.getState().stageFile(makeFile("{}"));
    expect(mockApi.inspectBackup).not.toHaveBeenCalled();
    expect(useBackup.getState().state).toMatchObject({
      kind: "idle",
      feedback: { status: "error" },
    });
  });

  it("enforces the 256 MiB guard before reading file text", async () => {
    const oversized = makeFile(
      "{}",
      "huge.json",
      MAX_BACKUP_FILE_BYTES + 1,
    );
    await useBackup.getState().stageFile(oversized);

    expect(mockApi.inspectBackup).not.toHaveBeenCalled();
    expect(useBackup.getState().state).toMatchObject({
      kind: "idle",
      feedback: { status: "error", text: "备份文件超过 256 MB 上限" },
    });
  });

  it("stages inspection, exports a safety copy inside dialog, and restores atomically", async () => {
    const inspection = makeInspection();
    mockApi.inspectBackup.mockResolvedValue(inspection);
    const safetyPath = "/tmp/backups/safety.json";
    mockApi.exportBackup.mockResolvedValue({
      filename: "safety.json",
      savedPath: safetyPath,
      exportedAt: "2026-11-20T06:01:00Z",
      formatVersion: 1,
      dbSchemaVersion: 9,
      counts: makeCounts(),
    } satisfies BackupExport);

    const restoredPrefs: ClientPreferences = {
      appearance: "light",
      sidebarCollapsed: true,
      sound: { enabled: false, volume: 42 },
    };
    const restoreResult: BackupRestoreResult = {
      restoredCounts: makeCounts({ games: 9, puzzles: 11 }),
      clientPreferences: restoredPrefs,
      warnings: [
        {
          code: "lichessTokenNotIncluded",
          message: "Token 未包含",
        },
      ],
    };
    mockApi.importBackup.mockResolvedValue(restoreResult);

    const settings = new Map<string, string>([
      ["lichess_username", "alice"],
      [
        "lichess_sync_v2:alice",
        JSON.stringify({
          completedThrough: null,
          pending: { since: null, until: 1000, upperBound: 1000 },
          read: 0,
          added: 0,
          unfinishedIds: [],
        }),
      ],
    ]);
    mockApi.getSetting.mockImplementation(
      async (key: string) => settings.get(key) ?? null,
    );
    useGameSync.setState({ message: "旧同步提示", pending: false, revision: 2 });

    await useBackup.getState().stageFile(makeFile('{"valid":true}', "snap.json"));
    expect(useBackup.getState().state).toMatchObject({
      kind: "confirming",
      fileName: "snap.json",
      inspection,
      exportingSafetyCopy: false,
    });

    await useBackup.getState().exportCurrent();
    expect(useBackup.getState().state).toMatchObject({
      kind: "confirming",
      safetyFeedback: {
        status: "success",
        text: expect.stringContaining(safetyPath),
      },
    });

    const onDatabaseRestored = vi.fn().mockResolvedValue(undefined);
    await useBackup.getState().confirmImport(onDatabaseRestored);

    expect(mockApi.importBackup).toHaveBeenCalledWith('{"valid":true}');
    expect(onDatabaseRestored).toHaveBeenCalledTimes(1);
    expect(readClientPreferences()).toEqual(restoredPrefs);
    expect(useGameSync.getState().message).toBe("");
    expect(useGameSync.getState().pending).toBe(true);
    expect(useGameSync.getState().revision).toBe(3);
    expect(useGameSync.getState().maintenanceBlocked).toBe(false);
    expect(useBackup.getState().state).toMatchObject({
      kind: "idle",
      feedback: { status: "success" },
    });
  });

  it("keeps existing client preferences when backup omits them and cancels cleanly", async () => {
    useAppearanceStore.getState().setAppearance("light");
    useSidebarPreference.getState().setCollapsed(true);
    useSoundSettings.getState().apply({ enabled: false, volume: 25 });

    applyClientPreferences(null);
    expect(readClientPreferences()).toEqual({
      appearance: "light",
      sidebarCollapsed: true,
      sound: { enabled: false, volume: 25 },
    });

    mockApi.inspectBackup.mockResolvedValue(
      makeInspection({ hasClientPreferences: false }),
    );
    await useBackup.getState().stageFile(makeFile("{}"));
    expect(useBackup.getState().state.kind).toBe("confirming");

    useBackup.getState().cancelImport();
    expect(useBackup.getState().state).toEqual({
      kind: "idle",
      feedback: null,
    });
  });

  it("preserves prior preferences and reports error when importBackup fails", async () => {
    mockApi.inspectBackup.mockResolvedValue(makeInspection());
    mockApi.importBackup.mockRejectedValue(new Error("格式校验失败"));

    await useBackup.getState().stageFile(makeFile("{}"));
    await useBackup.getState().confirmImport();

    expect(readClientPreferences()).toEqual({
      appearance: "dark",
      sidebarCollapsed: false,
      sound: { enabled: true, volume: 70 },
    });
    expect(useGameSync.getState().maintenanceBlocked).toBe(false);
    expect(useBackup.getState().state).toMatchObject({
      kind: "idle",
      feedback: { status: "error", text: "备份恢复失败：格式校验失败" },
    });
  });
});
