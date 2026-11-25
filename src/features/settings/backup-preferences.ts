import { useSoundSettings } from "../../shared/audio/settings";
import type { ClientPreferences } from "../../shared/types";
import { useAppearanceStore } from "../../shared/ui/AppTheme";
import { useSidebarPreference } from "../../shared/ui/sidebar";

export function readClientPreferences(): ClientPreferences {
  const appearance = useAppearanceStore.getState().appearance;
  const sidebarCollapsed = useSidebarPreference.getState().collapsed;
  const { enabled, volume } = useSoundSettings.getState();
  return {
    appearance,
    sidebarCollapsed,
    sound: { enabled, volume },
  };
}

export function applyClientPreferences(prefs: ClientPreferences | null): void {
  if (!prefs) return;
  useAppearanceStore.getState().setAppearance(prefs.appearance);
  useSidebarPreference.getState().setCollapsed(prefs.sidebarCollapsed);
  useSoundSettings.getState().apply(prefs.sound);
}
