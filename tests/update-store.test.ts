import { describe, expect, it, vi } from "vitest";
import {
  createUpdaterStore,
  type UpdateDependencies,
  type UpdateHandle,
} from "../src/features/updates/update-store";

function fixture() {
  const update: UpdateHandle = {
    version: "0.2.0",
    body: "新版说明",
    download: vi.fn<UpdateHandle["download"]>().mockResolvedValue(undefined),
    install: vi.fn<UpdateHandle["install"]>().mockResolvedValue(undefined),
    close: vi.fn<UpdateHandle["close"]>().mockResolvedValue(undefined),
  };
  const deps: UpdateDependencies = {
    check: vi.fn<UpdateDependencies["check"]>().mockResolvedValue(update),
    relaunch: vi
      .fn<UpdateDependencies["relaunch"]>()
      .mockResolvedValue(undefined),
    getVersion: vi
      .fn<UpdateDependencies["getVersion"]>()
      .mockResolvedValue("0.1.0"),
  };
  return { update, deps, store: createUpdaterStore(deps) };
}
describe("应用更新", () => {
  it("读取真实当前版本并去重请求，检查后显示新版与说明", async () => {
    const { store, deps } = fixture();
    await Promise.all([
      store.getState().loadVersion(),
      store.getState().loadVersion(),
    ]);
    expect(deps.getVersion).toHaveBeenCalledTimes(1);
    expect(store.getState().currentVersion).toBe("0.1.0");
    await store.getState().checkForUpdate();
    expect(store.getState()).toMatchObject({
      phase: "available",
      version: "0.2.0",
      notes: "新版说明",
    });
  });
  it("无新版时明确显示最新，检查失败后可重试", async () => {
    const { store, deps } = fixture();
    vi.mocked(deps.check)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(null);
    await store.getState().checkForUpdate();
    expect(store.getState().phase).toBe("error");
    await store.getState().checkForUpdate();
    expect(store.getState()).toMatchObject({
      phase: "current",
      message: "当前已是最新版本",
    });
  });
  it("下载累计进度，安装成功并释放资源后才重启", async () => {
    const { store, update, deps } = fixture();
    const stages: string[] = [];
    vi.mocked(update.download).mockImplementation(async (onEvent) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 60 } });
      expect(store.getState()).toMatchObject({
        phase: "downloading",
        total: 100,
        downloaded: 100,
      });
      onEvent?.({ event: "Finished" });
      stages.push("download");
    });
    vi.mocked(update.install).mockImplementation(async () => {
      expect(store.getState().phase).toBe("installing");
      stages.push("install");
    });
    vi.mocked(update.close).mockImplementation(async () => {
      stages.push("close");
    });
    vi.mocked(deps.relaunch).mockImplementation(async () => {
      stages.push("restart");
    });
    await store.getState().checkForUpdate();
    await store.getState().installUpdate();
    expect(stages).toEqual(["download", "install", "close", "restart"]);
  });
  it("下载或签名验证失败不得安装、重启，并可重新检查", async () => {
    const { store, update, deps } = fixture();
    vi.mocked(update.download).mockRejectedValueOnce(
      new Error("signature verification failed"),
    );
    await store.getState().checkForUpdate();
    await store.getState().installUpdate();
    expect(store.getState().phase).toBe("error");
    expect(update.install).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(update.close).toHaveBeenCalledTimes(1);
    await store.getState().checkForUpdate();
    expect(store.getState().phase).toBe("available");
  });
  it("安装失败不重启", async () => {
    const { store, update, deps } = fixture();
    vi.mocked(update.install).mockRejectedValue(new Error("permission denied"));
    await store.getState().checkForUpdate();
    await store.getState().installUpdate();
    expect(store.getState().phase).toBe("error");
    expect(deps.relaunch).not.toHaveBeenCalled();
  });
  it("重启失败保留已安装状态，重试不再次下载安装", async () => {
    const { store, update, deps } = fixture();
    vi.mocked(deps.relaunch)
      .mockRejectedValueOnce(new Error("restart failed"))
      .mockResolvedValueOnce(undefined);
    await store.getState().checkForUpdate();
    await store.getState().installUpdate();
    expect(store.getState().phase).toBe("installed");
    await store.getState().checkForUpdate();
    expect(deps.check).toHaveBeenCalledTimes(1);
    await store.getState().restart();
    expect(deps.relaunch).toHaveBeenCalledTimes(2);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(update.download).toHaveBeenCalledTimes(1);
  });
  it("忙碌时忽略重复检查、重复安装，未知长度的进度仍累计", async () => {
    const { store, update, deps } = fixture();
    let finish!: () => void;
    vi.mocked(deps.check).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(update);
        }),
    );
    const checking = store.getState().checkForUpdate();
    await store.getState().checkForUpdate();
    // check starts after releasing a previous optional resource.
    await Promise.resolve();
    finish();
    await checking;
    expect(deps.check).toHaveBeenCalledTimes(1);
    let downloaded!: () => void;
    vi.mocked(update.download).mockImplementation(
      (onEvent) =>
        new Promise((resolve) => {
          onEvent?.({ event: "Started", data: {} });
          onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
          downloaded = resolve;
        }),
    );
    const installing = store.getState().installUpdate();
    await store.getState().installUpdate();
    await store.getState().checkForUpdate();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      downloaded: 40,
      total: undefined,
    });
    downloaded();
    await installing;
  });
  it("重新检查时释放旧资源，释放失败不影响成功安装", async () => {
    const { store, update, deps } = fixture();
    await store.getState().checkForUpdate();
    await store.getState().checkForUpdate();
    expect(update.close).toHaveBeenCalledTimes(1);
    vi.mocked(update.close).mockRejectedValue(new Error("already closed"));
    await store.getState().installUpdate();
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });
});
