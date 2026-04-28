/**
 * Lightweight haptic feedback helpers. Uses the Vibration API where
 * available and silently no-ops otherwise (e.g. on desktop / iOS Safari).
 */

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  const v = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (typeof v !== "function") return;
  try {
    // Newer DOM typings narrow `vibrate` to `Iterable<number>`; our helper
    // intentionally accepts a scalar and lets the browser coerce it. Cast
    // through `Function` so we keep the helper's ergonomic surface area
    // without a runtime change.
    (v as (this: Navigator, p: number | number[]) => boolean).call(
      navigator,
      pattern,
    );
  } catch {
    // ignore
  }
}

/** A tiny tick — good for momentary state changes (e.g. target acquired). */
export function hapticTick() {
  vibrate(8);
}

/** A small tap — good for confirming a selection (e.g. star tapped). */
export function hapticTap() {
  vibrate(15);
}

/** A celebratory double-tap — used when a target is centered. */
export function hapticLockOn() {
  vibrate([10, 40, 20]);
}
