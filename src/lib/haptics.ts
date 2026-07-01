/**
 * Lightweight haptic feedback helpers. On native (Capacitor iOS/Android) these
 * drive the real taptic engine via @capacitor/haptics; on the web they fall
 * back to the Vibration API where available and silently no-op otherwise
 * (e.g. on desktop / iOS Safari).
 */

import { Capacitor } from "@capacitor/core";

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

// Lazy-loaded Haptics plugin — only imported on native so the plugin never
// lands in the web bundle where it isn't useful.
let hapticsPromise: Promise<typeof import("@capacitor/haptics")> | null = null;

function getHaptics() {
  if (!hapticsPromise) {
    hapticsPromise = import("@capacitor/haptics");
  }
  return hapticsPromise;
}

async function nativeImpact(style: "Light" | "Medium" | "Heavy") {
  const { Haptics, ImpactStyle } = await getHaptics();
  await Haptics.impact({ style: ImpactStyle[style] });
}

async function nativeSuccess() {
  const { Haptics, NotificationType } = await getHaptics();
  await Haptics.notification({ type: NotificationType.Success });
}

/** A tiny tick — good for momentary state changes (e.g. target acquired). */
export function hapticTick() {
  if (Capacitor.isNativePlatform()) {
    nativeImpact("Light").catch(() => {});
  } else {
    vibrate(8);
  }
}

/** A small tap — good for confirming a selection (e.g. star tapped). */
export function hapticTap() {
  if (Capacitor.isNativePlatform()) {
    nativeImpact("Medium").catch(() => {});
  } else {
    vibrate(15);
  }
}

/** A celebratory double-tap — used when a target is centered. */
export function hapticLockOn() {
  if (Capacitor.isNativePlatform()) {
    nativeSuccess().catch(() => {});
  } else {
    vibrate([10, 40, 20]);
  }
}
