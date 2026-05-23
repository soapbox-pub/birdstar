import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import { type Mode, ModeContext } from "@/contexts/ModeContext";
import { modeFromPath } from "@/lib/modeFromPath";

const STORAGE_KEY = "birdstar:mode";

function readStoredMode(): Mode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed === "birds" || parsed === "stars" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: Mode): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mode));
  } catch {
    // ignore — quota exceeded, private browsing, etc.
  }
}

/**
 * Provides the current mode (Birds vs Stars) to the app.
 *
 * Resolution order on first render:
 *
 *   1. **Path override.** If the URL is a Stars-only overlay route
 *      (`/zodiac/aries`, `/planet/mars`, `/sun`, `/moon`, `/star/:hip`,
 *      or a custom-constellation `naddr`), start in Stars regardless
 *      of stored preference. Without this, deep links shared from
 *      another device cold-load into Birds and the user has to click
 *      the toggle to see the thing they followed the link for.
 *      See `modeFromPath` for the full route list.
 *   2. **localStorage** (`birdstar:mode`) — the user's last explicit
 *      choice, persisted across sessions.
 *   3. **Default** — Birds, per AGENTS.md ("The app always starts in
 *      Birds mode on a fresh install").
 *
 * A path override is *not* written back to localStorage: a one-off
 * deep-link visit shouldn't permanently change a Birds user into a
 * Stars user. Only `setMode` (the mode-toggle pill) persists.
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  const [mode, setModeState] = useState<Mode>(() => {
    // Path override wins on first render. See JSDoc above for rationale.
    const forced = modeFromPath(pathname);
    if (forced) return forced;
    return readStoredMode() ?? "birds";
  });

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    writeStoredMode(m);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}
