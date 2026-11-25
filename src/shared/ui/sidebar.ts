import { create } from "zustand";
import { persist } from "zustand/middleware";

const storageKey = "chess-trainer-sidebar-collapsed";

function initialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "true") return true;
    if (saved === "false") return false;
  } catch {
    return false;
  }
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 900px)").matches
    : false;
}

export interface SidebarPreferenceStore {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

export const useSidebarPreference = create<SidebarPreferenceStore>()(
  persist(
    (set) => ({
      collapsed: initialCollapsed(),
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
      setCollapsed: (collapsed) => set({ collapsed }),
    }),
    {
      name: storageKey,
      partialize: ({ collapsed }) => ({ collapsed }),
      merge: (saved, current) => {
        if (typeof saved === "boolean") {
          return { ...current, collapsed: saved };
        }
        const settings = saved as Partial<SidebarPreferenceStore> | null;
        return {
          ...current,
          collapsed:
            typeof settings?.collapsed === "boolean"
              ? settings.collapsed
              : current.collapsed,
        };
      },
    },
  ),
);
