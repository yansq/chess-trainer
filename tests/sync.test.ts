import { describe, expect, it } from "vitest";
import type {
  GameImport,
  LichessExportGame,
  LichessSyncState,
} from "../src/shared/types";
import {
  readSyncState,
  syncAllGames,
  syncStateKey,
  SYNC_BATCH_SIZE,
} from "../src/features/games/sync";

const epoch = 1_790_000_000_000;
function harness(total: number) {
  let state = readSyncState(null);
  let now = epoch + 1_000_000;
  let failFetch = false;
  let failParse = false;
  let failSave = false;
  let pause = false;
  const saved = new Set<string>();
  const records: LichessExportGame[] = Array.from(
    { length: total },
    (_, i) => ({
      id: String(i),
      createdAt: epoch + i * 1000,
      pgn: "",
      status: "mate",
    }),
  );
  const requests: { since: number | null; until: number }[] = [];
  const deps = {
    getState: async () => structuredClone(state),
    refreshGames: async (ids: string[]) =>
      records.filter((g) => ids.includes(g.id)),
    now: () => now,
    shouldPause: () => pause,
    onProgress: () => {},
    exportBatch: async (since: number | null, until: number) => {
      requests.push({ since, until });
      if (failFetch) throw new Error("network failure");
      return records
        .filter(
          (g) =>
            g.createdAt <= until && (since === null || g.createdAt >= since),
        )
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, SYNC_BATCH_SIZE);
    },
    parseBatch: async (batch: LichessExportGame[]) => {
      if (failParse) throw new Error("invalid PGN");
      return batch.map((g) => ({ id: g.id }) as GameImport);
    },
    saveBatch: async (games: GameImport[], checkpoint: LichessSyncState) => {
      if (failSave) throw new Error("database failure");
      const added = games.filter((g) => !saved.has(g.id)).length;
      for (const g of games) saved.add(g.id);
      state = {
        ...structuredClone(checkpoint),
        added: checkpoint.added + added,
      };
      return structuredClone(state);
    },
  };
  return {
    deps,
    saved,
    records,
    requests,
    state: () => structuredClone(state),
    setNow: (value: number) => {
      now = value;
    },
    setState: (value: LichessSyncState) => {
      state = value;
    },
    failFetch: (value: boolean) => {
      failFetch = value;
    },
    failParse: (value: boolean) => {
      failParse = value;
    },
    failSave: (value: boolean) => {
      failSave = value;
    },
    pause: (value: boolean) => {
      pause = value;
    },
  };
}

describe("全量与增量同步", () => {
  it("超过 500 局仍补齐所有历史，下一次只查询增量范围", async () => {
    const h = harness(1201);
    h.setNow(epoch + 1201 * 1000);
    const first = await syncAllGames(h.deps);
    expect(h.saved.size).toBe(1201);
    expect(first.added).toBe(1201);
    expect(first.pending).toBeNull();
    expect(h.requests.length).toBeGreaterThan(12);
    // Advancing several days makes it possible to prove old history is not fetched.
    const later = epoch + 5 * 86_400_000;
    h.setState({ ...first, completedThrough: later });
    h.setNow(later + 1000);
    h.records.push({
      id: "new",
      createdAt: later + 500,
      pgn: "",
      status: "mate",
    });
    h.requests.length = 0;
    const incremental = await syncAllGames(h.deps);
    expect(h.requests).toEqual([
      { since: later - 86_400_000, until: later + 1000 },
    ]);
    expect(incremental.added).toBe(1);
    expect(incremental.read).toBe(1);
    expect(h.saved.size).toBe(1202);
  });

  it("网络失败后从已保存的批次继续，不把未完成全量当作增量", async () => {
    const h = harness(251);
    const deps = {
      ...h.deps,
      onProgress: (state: LichessSyncState) => {
        if (state.read >= 100) h.failFetch(true);
      },
    };
    await expect(syncAllGames(deps)).rejects.toThrow("network failure");
    expect(h.saved.size).toBe(100);
    expect(h.state().completedThrough).toBeNull();
    const cursor = h.state().pending!;
    h.failFetch(false);
    h.requests.length = 0;
    h.setNow(epoch + 2_000_000);
    const resumed = await syncAllGames(h.deps);
    expect(h.requests[0]).toEqual({ since: null, until: cursor.until });
    expect(resumed.completedThrough).toBe(cursor.upperBound);
    expect(resumed.added).toBe(251);
    expect(h.saved.size).toBe(251);
  });

  it("暂停保存当前批次，继续同步不会漏掉边界时间相同的对局", async () => {
    const h = harness(151);
    h.records[50].createdAt = h.records[51].createdAt;
    const paused = await syncAllGames({
      ...h.deps,
      onProgress: (state) => {
        if (state.read >= 100) h.pause(true);
      },
    });
    expect(paused.pending).not.toBeNull();
    expect(h.saved.size).toBe(100);
    h.pause(false);
    const resumed = await syncAllGames(h.deps);
    expect(resumed.pending).toBeNull();
    expect(h.saved.size).toBe(151);
    expect(resumed.added).toBe(151);
  });

  it("API 使用严格 until 边界时也不会漏掉同一毫秒创建的对局", async () => {
    const h = harness(151);
    h.records[50].createdAt = h.records[51].createdAt;
    const exportBatch = h.deps.exportBatch;
    const result = await syncAllGames({
      ...h.deps,
      exportBatch: async (since, until) => await exportBatch(since, until - 1),
    });
    expect(result.pending).toBeNull();
    expect(h.saved.size).toBe(151);
  });

  it("解析或保存失败不会推进已完成时间或当前分页边界", async () => {
    for (const fail of ["parse", "save"] as const) {
      const h = harness(151);
      const paused = await syncAllGames({
        ...h.deps,
        onProgress: (state) => {
          if (state.read >= 100) h.pause(true);
        },
      });
      h.pause(false);
      if (fail === "parse") h.failParse(true);
      else h.failSave(true);
      await expect(syncAllGames(h.deps)).rejects.toThrow();
      expect(h.state()).toEqual(paused);
      expect(h.saved.size).toBe(100);
    }
  });

  it("增量范围超过单批上限也会继续翻页，完成前保留原游标", async () => {
    const h = harness(351);
    h.setState({
      completedThrough: epoch,
      pending: null,
      read: 0,
      added: 0,
      unfinishedIds: [],
    });
    const first = await syncAllGames({
      ...h.deps,
      onProgress: (state) => {
        if (state.read >= 100) h.pause(true);
      },
    });
    expect(first.completedThrough).toBe(epoch);
    expect(first.pending?.since).toBe(epoch - 86_400_000);
    h.pause(false);
    const done = await syncAllGames(h.deps);
    expect(done.pending).toBeNull();
    expect(done.completedThrough).toBe(epoch + 1_000_000);
    expect(h.saved.size).toBe(351);
  });

  it("没有新对局时正常完成，不产生重复记录", async () => {
    const h = harness(2);
    await syncAllGames(h.deps);
    const repeated = await syncAllGames(h.deps);
    expect(repeated.added).toBe(0);
    expect(h.saved.size).toBe(2);
    const empty = harness(0);
    const done = await syncAllGames(empty.deps);
    expect(done.pending).toBeNull();
    expect(done.read).toBe(0);
  });

  it("只检查待结束的长对局，结束后补入，无需重下历史", async () => {
    const h = harness(2);
    h.records.push({
      id: "ongoing1",
      createdAt: epoch,
      pgn: "",
      status: "started",
    });
    h.setNow(epoch + 5 * 86_400_000);
    const full = await syncAllGames(h.deps);
    expect(full.unfinishedIds).toEqual(["ongoing1"]);
    expect(h.saved.has("ongoing1")).toBe(false);
    expect(h.saved.size).toBe(2);
    expect(readSyncState(JSON.stringify(full)).unfinishedIds).toEqual([
      "ongoing1",
    ]);
    h.records.find((g) => g.id === "ongoing1")!.status = "mate";
    h.requests.length = 0;
    const incremental = await syncAllGames(h.deps);
    expect(incremental.unfinishedIds).toEqual([]);
    expect(incremental.added).toBe(1);
    expect(h.saved.size).toBe(3);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].since).toBe(epoch + 4 * 86_400_000);
  });

  it("检查待结束对局失败不会丢弃 ID 或推进同步游标", async () => {
    const h = harness(0);
    h.setState({
      completedThrough: epoch,
      pending: null,
      read: 0,
      added: 0,
      unfinishedIds: ["ongoing1"],
    });
    await expect(
      syncAllGames({
        ...h.deps,
        refreshGames: async () => {
          throw new Error("refresh failed");
        },
      }),
    ).rejects.toThrow("refresh failed");
    expect(h.state().completedThrough).toBe(epoch);
    expect(h.state().unfinishedIds).toEqual(["ongoing1"]);
    expect(h.requests).toHaveLength(0);
  });

  it("拒绝按最后走棋时间排列的响应，避免按创建时间翻页时漏局", async () => {
    const h = harness(101);
    const exportBatch = h.deps.exportBatch;
    await expect(
      syncAllGames({
        ...h.deps,
        exportBatch: async (since, until) => {
          const batch = await exportBatch(since, until);
          [batch[0], batch[1]] = [batch[1], batch[0]];
          return batch;
        },
      }),
    ).rejects.toThrow("排序无效");
    expect(h.saved.size).toBe(0);
    expect(h.state().completedThrough).toBeNull();
  });

  it("按账号隔离游标，拒绝无效进度与无法前进的分页", async () => {
    expect(syncStateKey(" Trainer ")).toBe(syncStateKey("trainer"));
    expect(syncStateKey("Trainer")).not.toBe(syncStateKey("Opponent"));
    expect(() => readSyncState('{"completedThrough":"yesterday"}')).toThrow();
    const h = harness(100);
    h.setNow(epoch);
    for (const record of h.records) record.createdAt = epoch;
    await expect(syncAllGames(h.deps)).rejects.toThrow("无法安全推进");
    expect(h.state().completedThrough).toBeNull();
    expect(h.saved.size).toBe(0);
  });
});
