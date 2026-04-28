/**
 * Best-effort device and mobile-platform detection.
 *
 * Used exclusively for tailoring user-facing messaging (not for feature
 * gating). The goal is to keep the happy path silent on traditional
 * computers and provide actionable instructions on phones where sensor
 * permissions have gone wrong.
 */

export type DeviceClass = "phone" | "desktop" | "unknown";
export type MobilePlatform = "ios" | "android" | "other";

/** Chrome-exposed UA client hints. */
interface NavigatorUAData {
  mobile?: boolean;
}

/** iOS 13+ exposes a static requestPermission on DeviceOrientationEvent. */
interface DeviceOrientationEventIOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

function hasIOSOrientationAPI(): boolean {
  if (typeof window === "undefined") return false;
  const DOE = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationEventIOS })
    .DeviceOrientationEvent;
  return !!DOE && typeof DOE.requestPermission === "function";
}

function uaMatches(re: RegExp): boolean {
  if (typeof navigator === "undefined") return false;
  return re.test(navigator.userAgent || "");
}

/**
 * Pure UA/feature-based guess at the device class. Does NOT consider
 * permission state — use `getEffectiveDeviceClass` for that.
 */
export function guessDeviceClass(): DeviceClass {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unknown";
  }

  // Definitive phone/tablet signal: iOS 13+ gates orientation events
  // behind a static permission prompt that only iOS exposes.
  if (hasIOSOrientationAPI()) return "phone";

  // Modern Chromium-based browsers expose userAgentData with a `mobile`
  // boolean that's far more reliable than UA string sniffing.
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") {
    return uaData.mobile ? "phone" : "desktop";
  }

  const touch = (navigator.maxTouchPoints ?? 0) > 0;

  // Classic mobile UA patterns with a touch screen → phone.
  if (uaMatches(/iPhone|iPod/i)) return "phone";
  if (uaMatches(/Android.*Mobile|Mobile.*Android/i) && touch) return "phone";
  // iPad in modern Safari reports a Mac-like UA but has touch. We
  // conservatively call that a phone (same instructions apply).
  if (uaMatches(/iPad/i) || (uaMatches(/Macintosh/i) && touch)) return "phone";

  // Definitive desktop patterns with no touch → desktop.
  if (!touch && uaMatches(/Windows NT|Macintosh|Linux x86|CrOS/i)) return "desktop";

  return "unknown";
}

/**
 * Best-effort phone OS detection. Returns "other" when the device isn't
 * recognised as iOS or Android; callers should check that the device is
 * a phone first via `guessDeviceClass` / `getEffectiveDeviceClass`.
 */
export function getMobilePlatform(): MobilePlatform {
  if (typeof navigator === "undefined") return "other";
  // iOS: explicit API presence beats UA sniffing, and catches iPadOS in
  // its "desktop site" UA mode (which otherwise looks like macOS).
  if (hasIOSOrientationAPI()) return "ios";
  if (uaMatches(/iPhone|iPad|iPod/i)) return "ios";
  if (uaMatches(/Android/i)) return "android";
  return "other";
}

/**
 * Effective device class that folds in the current orientation-permission
 * status. A `denied` status is strong evidence that the device actually
 * has motion sensors (you can only deny access to something that exists),
 * so we treat it as a phone even if UA detection was ambiguous.
 */
export function getEffectiveDeviceClass(orientationStatus: string): DeviceClass {
  if (orientationStatus === "denied") return "phone";
  return guessDeviceClass();
}
