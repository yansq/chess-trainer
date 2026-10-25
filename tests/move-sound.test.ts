import { readFileSync } from "node:fs";
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
  decodeAudioData = vi.fn(async (_bytes: ArrayBuffer) => {
    void _bytes;
    return { length: 4800 };
  });
  createBufferSource() {
    const source = {
      buffer: null,
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      onended: null,
    };
    this.sources.push(source);
    return source;
  }
}

const fetchRecording = vi.fn(async (_url: string) => {
  void _url;
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
});

let audio: typeof import("../src/shared/audio/move-sound");
let settings: typeof import("../src/shared/audio/settings");
beforeEach(async () => {
  vi.resetModules();
  storage.clear();
  contexts.length = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  fetchRecording.mockReset().mockImplementation(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(16),
  }));
  vi.stubGlobal("fetch", fetchRecording);
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
  it("三段录音是可离线打包的 PCM WAV，非静音且峰值留有余量", () => {
    const lengths = [];
    for (const type of ["move", "capture", "check"]) {
      const wav = readFileSync(
        new URL(`../src/shared/audio/samples/${type}.wav`, import.meta.url),
      );
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
      let pcm: Buffer | undefined;
      for (let offset = 12; offset + 8 <= wav.length;) {
        const size = wav.readUInt32LE(offset + 4);
        const kind = wav.toString("ascii", offset, offset + 4);
        if (kind === "fmt ") {
          expect(wav.readUInt16LE(offset + 8)).toBe(1);
          expect(wav.readUInt16LE(offset + 10)).toBe(1);
          expect(wav.readUInt32LE(offset + 12)).toBe(48000);
          expect(wav.readUInt16LE(offset + 22)).toBe(16);
        }
        if (kind === "data") pcm = wav.subarray(offset + 8, offset + 8 + size);
        offset += 8 + size + (size % 2);
      }
      expect(pcm).toBeDefined();
      let peak = 0;
      for (let i = 0; i < pcm!.length; i += 2)
        peak = Math.max(peak, Math.abs(pcm!.readInt16LE(i) / 32768));
      expect(peak).toBeGreaterThan(0.1);
      expect(peak).toBeLessThan(0.8);
      expect(peak * 10 ** (1 / 20)).toBeLessThan(10 ** (-1 / 20));
      lengths.push(pcm!.length);
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
    expect(context.gain.value).toBeCloseTo(10 ** (1 / 20));
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
  it("只从内置地址读取录音，并复用已经解码的音效", async () => {
    await audio.playSound("move");
    await audio.playSound("move");
    expect(fetchRecording).toHaveBeenCalledOnce();
    const url = new URL(fetchRecording.mock.calls[0][0]);
    expect(url.protocol).toBe("file:");
    expect(url.pathname).toMatch(/samples\/move\.wav$/);
    expect(contexts[0].decodeAudioData).toHaveBeenCalledOnce();
    expect(contexts[0].sources).toHaveLength(2);
  });

  it("较早的录音延迟加载完成时不会盖过最新走子", async () => {
    let release!: (value: Awaited<ReturnType<typeof fetchRecording>>) => void;
    fetchRecording.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = audio.playSound("move");
    await vi.waitFor(() => expect(fetchRecording).toHaveBeenCalledOnce());
    expect(await audio.playSound("check")).toBe(true);
    release({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
    expect(await old).toBe(false);
    expect(contexts[0].sources).toHaveLength(1);
  });

  it("同一种录音的并发请求共享加载，仅播放最后一次", async () => {
    let release!: (value: Awaited<ReturnType<typeof fetchRecording>>) => void;
    fetchRecording.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = audio.playSound("move");
    await vi.waitFor(() => expect(fetchRecording).toHaveBeenCalledOnce());
    const latest = audio.playSound("move");
    release({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
    expect(await old).toBe(false);
    expect(await latest).toBe(true);
    expect(fetchRecording).toHaveBeenCalledOnce();
    expect(contexts[0].sources).toHaveLength(1);
  });

  it("解码期间静音后再取消静音，旧音效仍不会补播", async () => {
    const playing = audio.playSound("capture");
    await vi.waitFor(() =>
      expect(contexts[0].decodeAudioData).toHaveBeenCalledOnce(),
    );
    // Defer the subsequent sound's fetch to test muting during asynchronous work.
    let release!: (value: Awaited<ReturnType<typeof fetchRecording>>) => void;
    fetchRecording.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await playing;
    const pending = audio.playSound("check");
    await vi.waitFor(() => expect(fetchRecording).toHaveBeenCalledTimes(2));
    settings.useSoundSettings.getState().setEnabled(false);
    settings.useSoundSettings.getState().setEnabled(true);
    release({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
    expect(await pending).toBe(false);
    expect(contexts[0].sources).toHaveLength(1);
  });

  it("加载或解码失败可重试，不回退到合成音效", async () => {
    fetchRecording.mockResolvedValueOnce({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    expect(await audio.playSound("move")).toBe(false);
    expect(await audio.playSound("move")).toBe(true);
    contexts[0].decodeAudioData.mockRejectedValueOnce(
      new Error("invalid recording"),
    );
    expect(await audio.playSound("capture")).toBe(false);
    expect(await audio.playSound("capture")).toBe(true);
    expect(fetchRecording).toHaveBeenCalledTimes(4);
  });

  it("音频设备关闭后重建并重新解码，加载期间使用最新音量", async () => {
    expect(await audio.playSound("move")).toBe(true);
    contexts[0].state = "closed";
    const playing = audio.playSound("move");
    settings.useSoundSettings.getState().setVolume(25);
    expect(await playing).toBe(true);
    expect(contexts).toHaveLength(2);
    expect(contexts[1].gain.value).toBeCloseTo(10 ** (1 / 20) * 0.25 ** 1.4);
    expect(contexts[1].decodeAudioData).toHaveBeenCalledOnce();
    expect(fetchRecording).toHaveBeenCalledTimes(2);
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
