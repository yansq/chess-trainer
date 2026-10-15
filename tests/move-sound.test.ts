import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
  return storage;
});

const contexts: FakeAudioContext[] = [];
class FakeAudioContext {
  state = "suspended";
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  gain = {
    value: 0,
    setValueAtTime: (value: number) => {
      this.gain.value = value;
    },
    setTargetAtTime: (value: number) => {
      this.gain.value = value;
    },
  };
  sources: {
    buffer: { length: number } | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  constructor() {
    contexts.push(this);
  }
  resume = vi.fn(async () => {
    this.state = "running";
  });
  createGain() {
    return { gain: this.gain, connect: vi.fn() };
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  }
  createBufferSource() {
    const source = {
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
}

let audio: typeof import("../src/shared/audio/move-sound");
let settings: typeof import("../src/shared/audio/settings");
beforeEach(async () => {
  vi.resetModules();
  storage.clear();
  contexts.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  settings = await import("../src/shared/audio/settings");
  audio = await import("../src/shared/audio/move-sound");
});

describe("走子音效", () => {
  it("区分普通走子、吃子和将军，将军优先于吃子", () => {
    expect(audio.getMoveSoundType("e4")).toBe("move");
    expect(audio.getMoveSoundType("O-O")).toBe("move");
    expect(audio.getMoveSoundType("exd6")).toBe("capture");
    expect(audio.getMoveSoundType("Nxf7+")).toBe("check");
    expect(audio.getMoveSoundType("exd8=Q#")).toBe("check");
  });
  it("三种音效都有非静音信号，峰值不削波", () => {
    const lengths = [];
    for (const type of ["move", "capture", "check"] as const) {
      const data = audio.synthesizeMoveSound(type, 44100);
      const peak = data.reduce(
        (max, sample) => Math.max(max, Math.abs(sample)),
        0,
      );
      expect(peak).toBeGreaterThan(0.9);
      expect(peak).toBeLessThan(1);
      expect(data.every(Number.isFinite)).toBe(true);
      lengths.push(data.length);
    }
    expect(new Set(lengths).size).toBe(3);
  });
  it("关闭音效或音量为 0 时不启动音频设备", async () => {
    settings.useSoundSettings.getState().setEnabled(false);
    expect(await audio.playSound("move")).toBe(false);
    settings.useSoundSettings.getState().setEnabled(true);
    settings.useSoundSettings.getState().setVolume(0);
    expect(await audio.playSound("capture")).toBe(false);
    expect(contexts).toHaveLength(0);
  });
  it("复用音频设备，音量改变会实际改变输出增益", async () => {
    expect(await audio.playSound("move")).toBe(true);
    const context = contexts[0];
    const normalGain = context.gain.value;
    settings.useSoundSettings.getState().setVolume(25);
    expect(await audio.playSound("capture")).toBe(true);
    expect(context.gain.value).toBeLessThan(normalGain);
    expect(context.sources[0].stop).toHaveBeenCalledOnce();
    settings.useSoundSettings.getState().setVolume(100);
    expect(await audio.playSound("check")).toBe(true);
    expect(context.gain.value).toBe(0.8);
    expect(contexts).toHaveLength(1);
    expect(context.resume).toHaveBeenCalledOnce();
    for (const source of context.sources)
      expect(source.start).toHaveBeenCalledOnce();
    settings.useSoundSettings.getState().setEnabled(false);
    expect(context.gain.value).toBe(0);
  });
  it("设备不可用时静默返回，不影响走棋", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("device unavailable");
        }
      },
    );
    expect(await audio.playSound("check")).toBe(false);
  });
  it("音量与开关保存到本机，并可恢复", async () => {
    const store = settings.useSoundSettings;
    store.getState().setVolume(35);
    store.getState().setEnabled(false);
    expect(JSON.parse(storage.getItem("chess-trainer-sound")!).state).toEqual({
      enabled: false,
      volume: 35,
    });
    store.setState({ enabled: true, volume: 70 });
    storage.setItem(
      "chess-trainer-sound",
      JSON.stringify({ state: { enabled: false, volume: 35 }, version: 0 }),
    );
    await store.persist.rehydrate();
    expect(store.getState()).toMatchObject({ enabled: false, volume: 35 });
    expect(settings.normalizeVolume(200)).toBe(100);
    expect(settings.normalizeVolume(-10)).toBe(0);
    expect(settings.normalizeVolume(NaN)).toBe(70);
  });
});
