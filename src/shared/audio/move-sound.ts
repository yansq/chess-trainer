import { useSoundSettings } from "./settings";

export type MoveSoundType = "move" | "capture" | "check";

export function getMoveSoundType(san: string): MoveSoundType {
  if (/[+#]$/.test(san)) return "check";
  return san.includes("x") ? "capture" : "move";
}

// Short, normalized samples keep each effect clear without stacking loud voices.
export function synthesizeMoveSound(
  type: MoveSoundType,
  sampleRate: number,
): Float32Array {
  const duration = type === "check" ? 0.34 : type === "capture" ? 0.2 : 0.12;
  const data = new Float32Array(Math.ceil(duration * sampleRate));
  const taps =
    type === "check" ? [0, 0.12] : type === "capture" ? [0, 0.055] : [0];
  let seed = 12345;
  for (const [tap, offset] of taps.entries()) {
    const frequency =
      type === "check"
        ? [880, 1174.66][tap]
        : type === "capture"
          ? 230 + tap * 100
          : 520;
    const decay = type === "check" ? 0.055 : type === "capture" ? 0.025 : 0.02;
    const start = Math.round(offset * sampleRate);
    for (let i = start; i < data.length; i++) {
      const time = (i - start) / sampleRate;
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const noise = seed / 2147483648;
      const tone =
        Math.sin(2 * Math.PI * frequency * time) +
        0.35 * Math.sin(2 * Math.PI * frequency * 2.7 * time);
      const envelope = Math.min(1, time / 0.002) * Math.exp(-time / decay);
      data[i] += (tone + (type === "check" ? 0 : noise * 0.25)) * envelope;
    }
  }
  const peak = data.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    0,
  );
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.95 / peak;
  return data;
}

let context: AudioContext | undefined;
let master: GainNode | undefined;
let active: AudioBufferSourceNode | undefined;
const buffers = new Map<MoveSoundType, AudioBuffer>();

useSoundSettings.subscribe(({ enabled, volume }) => {
  if (context && context.state !== "closed" && master) {
    master.gain.setTargetAtTime(
      enabled ? 0.8 * (volume / 100) ** 1.4 : 0,
      context.currentTime,
      0.01,
    );
  }
});

export async function playSound(type: MoveSoundType): Promise<boolean> {
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
    if (context.state === "suspended") await context.resume();
    // Settings may change while the audio device is waking up.
    const { enabled, volume } = useSoundSettings.getState();
    if (!enabled || volume === 0 || context.state !== "running") return false;
    let buffer = buffers.get(type);
    if (!buffer) {
      const data = synthesizeMoveSound(type, context.sampleRate);
      buffer = context.createBuffer(1, data.length, context.sampleRate);
      buffer.getChannelData(0).set(data);
      buffers.set(type, buffer);
    }
    master!.gain.setValueAtTime(
      0.8 * (volume / 100) ** 1.4,
      context.currentTime,
    );
    active?.stop();
    active = context.createBufferSource();
    active.buffer = buffer;
    active.connect(master!);
    active.start();
    return true;
  } catch {
    // An unavailable audio device must not interrupt a legal chess move.
    return false;
  }
}

export function playMoveSound(san: string): void {
  void playSound(getMoveSoundType(san));
}
