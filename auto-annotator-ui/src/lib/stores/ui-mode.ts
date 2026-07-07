/**
 * Console complexity mode, persisted per browser.
 *
 * "simple" — guided, few options, sensible defaults everywhere. The default
 * so first-time users (and judges) land on the easy path.
 * "pro" — the full control plane: every knob, terminal, telemetry.
 *
 * Safe to read in any (app) page: the app layout renders nothing until the
 * auth store hydrates, so there is no SSR/client mismatch to worry about.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UiMode = "simple" | "pro";

interface UiModeState {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
}

export const useUiModeStore = create<UiModeState>()(
  persist(
    (set) => ({
      mode: "simple",
      setMode: (mode) => set({ mode }),
    }),
    { name: "aa-ui-mode" },
  ),
);
