import { useContext } from "react";
import {
  ModeContext,
  type ModeContextType,
} from "@/contexts/ModeContext";

/**
 * Read the current user-selected mode and its resolved effective mode.
 * Throws outside a {@link ModeProvider}.
 */
export function useMode(): ModeContextType {
  const ctx = useContext(ModeContext);
  if (!ctx) {
    throw new Error("useMode must be used within a ModeProvider");
  }
  return ctx;
}
