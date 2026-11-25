import { create } from "zustand";
import type { GameFilter } from "../../shared/types";

export const initialGameFilter: GameFilter = {
  opponentType: "human",
  source: null,
  color: null,
  result: null,
  speed: null,
  reviewed: null,
  opening: null,
  limit: 10,
  offset: 0,
};

export function offsetForIndex(index: number, limit: number): number {
  const safeLimit = Math.max(1, limit);
  return Math.floor(Math.max(0, index) / safeLimit) * safeLimit;
}

interface GamesFilterStore {
  filter: GameFilter;
  setFilter: (
    next: GameFilter | ((previous: GameFilter) => GameFilter),
  ) => void;
}

export const useGamesFilterStore = create<GamesFilterStore>((set) => ({
  filter: initialGameFilter,
  setFilter: (next) =>
    set((state) => ({
      filter: typeof next === "function" ? next(state.filter) : next,
    })),
}));
