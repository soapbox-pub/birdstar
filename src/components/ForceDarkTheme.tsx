import { useEffect } from "react";

/**
 * Pins the `dark` class on `<html>` for as long as this component is
 * mounted. Used in Stars mode where the sky map can only be rendered
 * against a black background.
 *
 * We use a MutationObserver rather than a one-shot `classList.add`
 * because `AppProvider.useApplyTheme` rewrites the root's classes
 * when the user flips their theme preference (light / dark / system)
 * or when the OS-level preference changes. Without the observer the
 * stars UI would briefly render over a white background mid-mount,
 * and flipping the theme setting while in stars mode would strip the
 * dark class out from under us.
 *
 * On unmount we restore whatever the classList looked like before we
 * interfered, so bird mode keeps its configured theme.
 */
export function ForceDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    const hadLight = root.classList.contains("light");

    const pin = () => {
      if (!root.classList.contains("dark")) root.classList.add("dark");
      // `.light` and `.dark` are mutually exclusive in this app's theme
      // system; clear light so our forced dark isn't shadowed by it.
      if (root.classList.contains("light")) root.classList.remove("light");
    };
    pin();

    const observer = new MutationObserver(pin);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
      // Best-effort restore of the pre-mount state. If the theme changed
      // while we were mounted, `useApplyTheme` will re-derive the correct
      // classes on its own effect; we only need to undo *our* additions.
      if (!hadDark) root.classList.remove("dark");
      if (hadLight) root.classList.add("light");
    };
  }, []);
  return null;
}
