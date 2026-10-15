import { create } from "zustand";
import { persist } from "zustand/middleware";

export function normalizeVolume(volume: number): number {
  return Number.isFinite(volume)
    ? Math.max(0, Math.min(100, Math.round(volume)))
    : 70;
}

interface SoundSettings {
  enabled: boolean;
  volume: number;
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
}

export const useSoundSettings = create<SoundSettings>()(
  persist(
    (set) => ({
      enabled: true,
      volume: 70,
      setEnabled: (enabled) => set({ enabled }),
      setVolume: (volume) => set({ volume: normalizeVolume(volume) }),
    }),
    {
      name: "chess-trainer-sound",
      partialize: ({ enabled, volume }) => ({ enabled, volume }),
      merge: (saved, current) => {
        const settings = saved as Partial<SoundSettings> | null;
        return {
          ...current,
          enabled:
            typeof settings?.enabled === "boolean" ? settings.enabled : true,
          volume:
            typeof settings?.volume === "number"
              ? normalizeVolume(settings.volume)
              : 70,
        };
      },
    },
  ),
);
