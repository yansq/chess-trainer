import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChessComGame,
  ChessComSyncState,
  GameImport,
  LichessExportGame,
  LichessSyncState,
} from "../src/shared/types";
import {
  parseChessComBatch,
  parseLichessBatch,
} from "../src/features/games/pgn";
const mock = vi.hoisted(() => ({
  getSetting: vi.fn(),
  lichessExportBatch: vi.fn(),
  lichessRefreshGames: vi.fn(),
  importSyncBatch: vi.fn(),
  chessComArchives: vi.fn(),
  chessComMonth: vi.fn(),
  importChessComBatch: vi.fn(),
}));
vi.mock("../src/shared/api", () => ({ api: mock }));
import { useGameSync } from "../src/features/games/sync-store";
const lichess: LichessExportGame = {
  id: "abcdefgh",
  createdAt: Date.parse("2026-10-02T00:00:00Z"),
  status: "mate",
  pgn: '[Site "https://lichess.org/abcdefgh"]\n[White "LUser"]\n[Black "Other"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
};
function chessGame(month: string): ChessComGame {
  return {
    url: "https://www.chess.com/game/live/" + month.slice(5),
    rules: "chess",
    time_class: "rapid",
    time_control: "600",
    end_time: Date.parse(month.replace("/", "-") + "-01T00:00:00Z") / 1000,
    rated: true,
    white: { username: "CUser", result: "win" },
    black: { username: "Other", result: "resigned" },
    pgn: '[White "CUser"]\n[Black "Other"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
  };
}
let settings: Map<string, string>, saved: Set<string>;
beforeEach(() => {
  vi.resetAllMocks();
  settings = new Map([
    ["lichess_username", "LUser"],
    ["chesscom_username", "CUser"],
  ]);
  saved = new Set();
  useGameSync.setState({
    running: false,
    pausing: false,
    message: "",
    pending: false,
    revision: 0,
  });
  mock.getSetting.mockImplementation(
    async (key: string) => settings.get(key) ?? null,
  );
  mock.lichessExportBatch.mockImplementation(
    async (_name: string, since: number | null, until: number) =>
      until >= lichess.createdAt &&
      (since === null || lichess.createdAt >= since)
        ? [lichess]
        : [],
  );
  mock.lichessRefreshGames.mockResolvedValue([]);
  mock.chessComArchives.mockResolvedValue(["2026/09", "2026/10"]);
  mock.chessComMonth.mockImplementation(
    async (_name: string, month: string) => [chessGame(month)],
  );
  const persist = async (
    key: string,
    games: GameImport[],
    state: ChessComSyncState | LichessSyncState,
  ) => {
    let added = 0;
    for (const game of games) {
      if (!saved.has(game.id)) added++;
      saved.add(game.id);
    }
    const next = { ...state, added: state.added + added };
    settings.set(key, JSON.stringify(next));
    return next;
  };
  mock.importSyncBatch.mockImplementation(
    (username: string, games: GameImport[], state: LichessSyncState) =>
      persist("lichess_sync_v2:" + username.toLowerCase(), games, state),
  );
  mock.importChessComBatch.mockImplementation(
    (username: string, games: GameImport[], state: ChessComSyncState) =>
      persist("chesscom_sync_v1:" + username.toLowerCase(), games, state),
  );
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(
        data:
          | { source: "chesscom"; batch: ChessComGame[]; username: string }
          | { source: "lichess"; batch: LichessExportGame[]; username: string },
      ) {
        queueMicrotask(() => {
          try {
            const games =
              data.source === "chesscom"
                ? parseChessComBatch(data.batch, data.username)
                : parseLichessBatch(data.batch, data.username);
            this.onmessage?.({ data: { games } } as MessageEvent);
          } catch (error) {
            this.onmessage?.({
              data: { error: String(error) },
            } as MessageEvent);
          }
        });
      }
      terminate() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("multi-platform sync coordinator", () => {
  it("syncs both configured accounts and deduplicates repeat sync", async () => {
    await useGameSync.getState().start();
    expect(saved.size).toBe(3);
    expect(mock.lichessExportBatch).toHaveBeenCalled();
    expect(mock.chessComMonth).toHaveBeenCalledTimes(2);
    expect(useGameSync.getState().message).toContain("Lichess：同步完成");
    expect(useGameSync.getState().message).toContain("Chess.com：同步完成");
    await useGameSync.getState().start();
    expect(saved.size).toBe(3);
    expect(useGameSync.getState().running).toBe(false);
  });
  it("continues Lichess when Chess.com fails and retains separate results", async () => {
    mock.chessComArchives.mockRejectedValue(Error("Chess.com offline"));
    await useGameSync.getState().start();
    expect(saved.has("lichess:abcdefgh")).toBe(true);
    expect(useGameSync.getState().message).toContain("Lichess：同步完成");
    expect(useGameSync.getState().message).toContain("Chess.com offline");
  });
  it("supports Chess.com alone and starts no network work with neither account", async () => {
    settings.delete("lichess_username");
    await useGameSync.getState().start();
    expect(saved.size).toBe(2);
    expect(mock.lichessExportBatch).not.toHaveBeenCalled();
    settings.delete("chesscom_username");
    mock.chessComArchives.mockClear();
    await useGameSync.getState().start();
    expect(mock.chessComArchives).not.toHaveBeenCalled();
    expect(useGameSync.getState().message).toContain("请先");
  });
  it("pauses after the active monthly transaction and resumes pending work", async () => {
    let release: (games: ChessComGame[]) => void = () => {};
    mock.chessComMonth.mockImplementationOnce(
      () =>
        new Promise<ChessComGame[]>((resolve) => {
          release = resolve;
        }),
    );
    const active = useGameSync.getState().start();
    await vi.waitFor(() => expect(mock.chessComMonth).toHaveBeenCalledTimes(1));
    useGameSync.getState().pause();
    await useGameSync.getState().start();
    release([chessGame("2026/09")]);
    await active;
    expect(useGameSync.getState().pending).toBe(true);
    expect(mock.chessComMonth).toHaveBeenCalledTimes(1);
    await useGameSync.getState().start();
    expect(
      useGameSync.getState().pending,
      useGameSync.getState().message + JSON.stringify([...settings]),
    ).toBe(false);
    expect(saved.size).toBe(3);
  });
});
