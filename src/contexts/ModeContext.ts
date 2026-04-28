import { createContext } from "react";

/**
 * The three values the user can pick from in the top-left dropdown.
 *
 * - `"auto"`: the *user-selected* mode. In this state the app decides
 *   between birds and stars based on the local sun altitude (see
 *   {@link useEffectiveMode}). This is the default.
 * - `"birds"`: force bird mode regardless of time of day.
 * - `"stars"`: force star mode regardless of time of day.
 */
export type Mode = "auto" | "birds" | "stars";

/**
 * The *rendered* mode after resolving `"auto"`. Always exactly one of
 * the two concrete experiences; consumers render against this and
 * don't have to branch on `"auto"`.
 */
export type EffectiveMode = "birds" | "stars";

export interface ModeContextType {
  /** The user's pick. Persisted to localStorage. */
  mode: Mode;
  /** Resolved mode after Auto → birds/stars mapping. */
  effectiveMode: EffectiveMode;
  /** Setter for `mode`. */
  setMode: (m: Mode) => void;
}

export const ModeContext = createContext<ModeContextType | undefined>(
  undefined,
);
