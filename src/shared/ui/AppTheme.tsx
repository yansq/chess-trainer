import { Theme } from "@radix-ui/themes";
import { useLayoutEffect, type ReactNode } from "react";
import { create } from "zustand";
import type { Appearance } from "../types";

const storageKey = "chess-trainer-appearance";

export function initialAppearance(): Appearance {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function persistAppearance(appearance: Appearance): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.appearance = appearance;
  }
  try {
    localStorage.setItem(storageKey, appearance);
  } catch {
    return;
  }
}

export interface AppearanceStore {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  toggle: () => void;
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => ({
  appearance: initialAppearance(),
  setAppearance: (appearance) => {
    persistAppearance(appearance);
    set({ appearance });
  },
  toggle: () => {
    const next = get().appearance === "dark" ? "light" : "dark";
    get().setAppearance(next);
  },
}));

export function useAppearance() {
  const appearance = useAppearanceStore((s) => s.appearance);
  const setAppearance = useAppearanceStore((s) => s.setAppearance);
  const toggle = useAppearanceStore((s) => s.toggle);
  return { appearance, setAppearance, toggle };
}

export function AppTheme({
  initial,
  children,
}: {
  initial: Appearance;
  children: ReactNode;
}) {
  const appearance = useAppearanceStore((s) => s.appearance);

  useLayoutEffect(() => {
    useAppearanceStore.getState().setAppearance(initial);
  }, [initial]);

  return (
    <Theme
      appearance={appearance}
      accentColor="bronze"
      grayColor="sand"
      panelBackground="solid"
      radius="medium"
      className="h-full min-h-0"
    >
      {children}
    </Theme>
  );
}
