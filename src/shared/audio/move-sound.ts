import { useSoundSettings } from "./settings";

export type MoveSoundType = "move" | "capture" | "check";

export function getMoveSoundType(san: string): MoveSoundType {
  if (/[+#]$/.test(san)) return "check";
  return san.includes("x") ? "capture" : "move";
}

// Vite emits these recordings into the application bundle for offline playback.
const recordings: Record<MoveSoundType, string> = {
  move: new URL("./samples/move.wav", import.meta.url).href,
  capture: new URL("./samples/capture.wav", import.meta.url).href,
  check: new URL("./samples/check.wav", import.meta.url).href,
};

// +1 dB; the loudest recording still has more than 1 dB of true-peak headroom.
const playbackGain = 10 ** (1 / 20);

let context: AudioContext | undefined;
let master: GainNode | undefined;
let active: AudioBufferSourceNode | undefined;
const buffers = new Map<MoveSoundType, Promise<AudioBuffer>>();
let playbackRequest = 0;

useSoundSettings.subscribe(({ enabled, volume }) => {
  // Muting also invalidates sounds still waiting for local loading/decoding.
  if (!enabled || volume === 0) playbackRequest++;
  if (context && context.state !== "closed" && master) {
    master.gain.setTargetAtTime(
      enabled ? playbackGain * (volume / 100) ** 1.4 : 0,
      context.currentTime,
      0.01,
    );
  }
});

export async function playSound(type: MoveSoundType): Promise<boolean> {
  const request = ++playbackRequest;
  const settings = useSoundSettings.getState();
  if (!settings.enabled || settings.volume === 0) return false;
  try {
    if (!context || context.state === "closed") {
      context = new AudioContext();
      master = context.createGain();
      master.connect(context.destination);
      buffers.clear();
      active = undefined;
    }
    const device = context;
    if (device.state === "suspended") await device.resume();
    if (request !== playbackRequest || device.state !== "running") return false;
    let loading = buffers.get(type);
    if (!loading) {
      loading = fetch(recordings[type])
        .then((response) => {
          if (!response.ok) throw new Error("音效文件加载失败");
          return response.arrayBuffer();
        })
        .then((bytes) => device.decodeAudioData(bytes));
      buffers.set(type, loading);
      const pending = loading;
      void pending.catch(() => {
        if (buffers.get(type) === pending) buffers.delete(type);
      });
    }
    const buffer = await loading;
    // The user may navigate, mute or change volume while a recording loads.
    const { enabled, volume } = useSoundSettings.getState();
    if (
      request !== playbackRequest ||
      device !== context ||
      device.state !== "running" ||
      !enabled ||
      volume === 0
    )
      return false;
    master!.gain.setValueAtTime(
      playbackGain * (volume / 100) ** 1.4,
      device.currentTime,
    );
    active?.stop();
    const source = device.createBufferSource();
    source.buffer = buffer;
    source.connect(master!);
    source.onended = () => {
      source.disconnect();
      if (active === source) active = undefined;
    };
    active = source;
    source.start();
    return true;
  } catch {
    // Audio failures must not interrupt a legal chess move; later calls can retry.
    return false;
  }
}

export function playMoveSound(san: string): void {
  void playSound(getMoveSoundType(san));
}
