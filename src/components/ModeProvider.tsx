import { type ReactNode, useCallback, useMemo } from "react";

import { type Mode, ModeContext } from "@/contexts/ModeContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const STORAGE_KEY = "birdstar:mode";

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useLocalStorage<Mode>(STORAGE_KEY, "birds");

  const setMode = useCallback((m: Mode) => setModeState(m), [setModeState]);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}
