/**
 * Registry of forms currently holding unsaved user input, keyed by form id.
 *
 * Switching Simple/Pro swaps whole page trees, unmounting any in-progress
 * form — the topbar ModeToggle consults this store so it only asks for
 * confirmation when there is actually something to lose.
 */
import { useEffect } from "react";
import { create } from "zustand";

interface UnsavedState {
  dirty: Record<string, true>;
  setDirty: (key: string, value: boolean) => void;
}

export const useUnsavedStore = create<UnsavedState>()((set) => ({
  dirty: {},
  setDirty: (key, value) =>
    set((s) => {
      if (!!s.dirty[key] === value) return s;
      const dirty = { ...s.dirty };
      if (value) dirty[key] = true;
      else delete dirty[key];
      return { dirty };
    }),
}));

export const useAnyUnsaved = () =>
  useUnsavedStore((s) => Object.keys(s.dirty).length > 0);

/** Report a form's dirty state; automatically cleared on unmount. */
export function useReportUnsaved(key: string, isDirty: boolean) {
  const setDirty = useUnsavedStore((s) => s.setDirty);
  useEffect(() => {
    setDirty(key, isDirty);
    return () => setDirty(key, false);
  }, [key, isDirty, setDirty]);
}
