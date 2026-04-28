import { createContext } from "react";

/**
 * The two experiences the app can render.
 *
 * Birds is the default; the user flips to Stars via the mode toggle in
 * the top-left. There is no auto-by-time-of-day behavior — keeping the
 * choice explicit avoids surprises (e.g. the app switching out from
 * under someone mid-session when the sun sets).
 */
export type Mode = "birds" | "stars";

export interface ModeContextType {
  /** The user's current mode. Persisted to localStorage. */
  mode: Mode;
  /** Setter for `mode`. */
  setMode: (m: Mode) => void;
}

export const ModeContext = createContext<ModeContextType | undefined>(
  undefined,
);
