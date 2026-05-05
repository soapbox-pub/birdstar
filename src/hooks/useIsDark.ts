import { useEffect, useState } from "react";

/**
 * Reactive flag for "is the app currently in dark mode?" — derived from
 * the `dark` class on `<html>`, which is the source of truth that
 * `AppProvider.useApplyTheme` and `ForceDarkTheme` both write to.
 *
 * Reading the class directly (rather than `config.theme`) is what lets
 * this work cleanly across:
 *
 *   - explicit `light` / `dark` theme settings,
 *   - `"system"` theme that follows the OS preference,
 *   - `ForceDarkTheme` pinning `dark` on for Stars mode.
 *
 * We subscribe with a `MutationObserver` scoped to `<html>`'s
 * `class` attribute so a theme flip updates this instantly without
 * polling.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return isDark;
}
