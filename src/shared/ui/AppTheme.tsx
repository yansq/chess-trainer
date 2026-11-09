import { Theme } from "@radix-ui/themes";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

type Appearance = "light" | "dark";
const storageKey = "chess-trainer-appearance";
const AppearanceContext = createContext({
  appearance: "dark" as Appearance,
  toggle: () => {},
});

export function initialAppearance(): Appearance {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function useAppearance() {
  return useContext(AppearanceContext);
}

export function AppTheme({
  initial,
  children,
}: {
  initial: Appearance;
  children: ReactNode;
}) {
  const [appearance, setAppearance] = useState(initial);
  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    try {
      localStorage.setItem(storageKey, appearance);
    } catch {
      // A disabled/full storage must not prevent switching the current view.
    }
  }, [appearance]);
  return (
    <AppearanceContext.Provider
      value={{
        appearance,
        toggle: () =>
          setAppearance((value) => (value === "dark" ? "light" : "dark")),
      }}
    >
      <Theme
        appearance={appearance}
        accentColor="gray"
        grayColor="gray"
        radius="medium"
        className="h-full min-h-0"
      >
        {children}
      </Theme>
    </AppearanceContext.Provider>
  );
}
