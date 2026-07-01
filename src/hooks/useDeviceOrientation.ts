import { useCallback, useEffect, useRef, useState } from "react";

export interface DeviceOrientation {
  /** Compass heading (degrees from north, 0-360) of where the device's BACK is facing */
  azimuth: number;
  /** Altitude angle in degrees of where the device's BACK is pointing (−90 down, 0 horizon, +90 zenith) */
  altitude: number;
  /** Device roll (rotation around the back-pointing axis), degrees */
  roll: number;
  /** Whether we received a real orientation event */
  available: boolean;
  /** Whether orientation data seems to include absolute compass heading */
  absolute: boolean;
}

/**
 * Sensor availability status.
 *
 *  - "idle": haven't attempted to use sensors yet. On platforms that don't
 *    require explicit permission (Android, desktop) we jump straight to
 *    "probing" on mount; "idle" is used when we're waiting for a user
 *    gesture (iOS) before even trying.
 *  - "probing": attached a listener and waiting to see if events arrive.
 *  - "active": at least one real orientation event has fired; sensor is
 *    confirmed working.
 *  - "unavailable": probe window elapsed without any events. Either the
 *    device has no sensors or the environment doesn't expose them (most
 *    desktop browsers fall here).
 *  - "denied": user explicitly denied motion permission (iOS 13+).
 */
export type OrientationStatus =
  | "idle"
  | "probing"
  | "active"
  | "unavailable"
  | "denied";

// iOS requires calling a static permission request function on a user gesture.
interface DeviceOrientationEventIOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/** How long to wait for the first orientation event before declaring the sensor unavailable. */
const PROBE_TIMEOUT_MS = 1500;

/** Normalize an angle to 0..360 */
function norm360(a: number): number {
  return ((a % 360) + 360) % 360;
}

/** Shortest signed delta b - a, in (-180, 180] */
function angleDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  // Guard against the -180 edge
  if (d <= -180) d += 360;
  return d;
}

/**
 * Smooth an angle (in degrees) with exponential smoothing, correctly
 * handling 0/360 wrap-around.
 */
function smoothAngle(prev: number, next: number, alpha: number): number {
  const d = angleDelta(prev, next);
  return norm360(prev + d * alpha);
}

/** Does this browser require a user-gesture permission prompt for orientation? */
function needsIOSPermission(): boolean {
  const DOE = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationEventIOS })
    .DeviceOrientationEvent;
  return !!DOE && typeof DOE.requestPermission === "function";
}

/**
 * Returns a live orientation describing where the back of the phone is pointing.
 *
 * alpha, beta, gamma (DeviceOrientation spec):
 *  - alpha: rotation around Z axis (compass-ish), 0..360
 *  - beta:  rotation around X axis (front-back tilt), -180..180
 *  - gamma: rotation around Y axis (left-right tilt), -90..90
 *
 * We build a rotation matrix and extract the vector that points out the back
 * of the phone (when held with screen up, this is opposite the screen normal).
 */
export function useDeviceOrientation(options?: {
  /** Smoothing factor 0..1 applied per update; lower = smoother but laggier */
  smoothing?: number;
}) {
  const { smoothing = 0.25 } = options ?? {};

  const [orientation, setOrientation] = useState<DeviceOrientation>({
    azimuth: 0,
    altitude: 0,
    roll: 0,
    available: false,
    absolute: false,
  });
  const [status, setStatus] = useState<OrientationStatus>(() => {
    if (typeof window === "undefined") return "unavailable";
    if (needsIOSPermission()) return "idle"; // needs user gesture first
    if (typeof window.DeviceOrientationEvent === "undefined") return "unavailable";
    return "probing"; // we'll attach and wait to see if events arrive
  });
  const screenAngleRef = useRef<number>(0);
  // Smoothed values (kept in a ref so updates don't trigger re-renders until flush)
  const smoothedRef = useRef<{
    azimuth: number;
    altitude: number;
    roll: number;
    initialized: boolean;
  }>({ azimuth: 0, altitude: 0, roll: 0, initialized: false });

  // Track screen orientation so we compensate when user rotates the phone
  useEffect(() => {
    const update = () => {
      const angle =
        (screen.orientation && typeof screen.orientation.angle === "number"
          ? screen.orientation.angle
          : (window.orientation as number | undefined) ?? 0) || 0;
      screenAngleRef.current = angle;
    };
    update();
    window.addEventListener("orientationchange", update);
    screen.orientation?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("orientationchange", update);
      screen.orientation?.removeEventListener?.("change", update);
    };
  }, []);

  // Keep smoothing in a ref so listener always reads fresh values.
  const smoothingRef = useRef(smoothing);
  useEffect(() => {
    smoothingRef.current = smoothing;
  }, [smoothing]);

  // Ref-based signal indicating whether at least one real event has been
  // processed. Used by the probe timer to decide pass/fail without relying
  // on a stale closure over React state.
  const gotEventRef = useRef(false);

  // We keep the listener-attach logic in a ref-stable callback so the effect
  // below can reuse it without depending on anything that changes on every render.
  const attachListener = useCallback(() => {
    const handler = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;

      const alpha = e.alpha; // deg
      const beta = e.beta;
      const gamma = e.gamma;
      // Some implementations set webkitCompassHeading (iOS Safari)
      const withCompass = e as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
      };
      const compassHeading = withCompass.webkitCompassHeading;

      const screenAngle = screenAngleRef.current;

      // Build rotation matrix per W3C spec (Z-X'-Y'' intrinsic Tait-Bryan):
      // R = Rz(alpha) * Rx(beta) * Ry(gamma)
      const a = (alpha * Math.PI) / 180;
      const b = (beta * Math.PI) / 180;
      const g = (gamma * Math.PI) / 180;
      const s = (screenAngle * Math.PI) / 180;

      const ca = Math.cos(a), sa = Math.sin(a);
      const cb = Math.cos(b), sb = Math.sin(b);
      const cg = Math.cos(g), sg = Math.sin(g);

      // World frame: x = east, y = north, z = up (when alpha=0, device +Y points north)
      // Column 2 of Rx*Ry is [sg, -sb*cg, cb*cg]
      // Rz applied: [ca*sg + sa*sb*cg, sa*sg - ca*sb*cg, cb*cg]
      const col2x = ca * sg + sa * sb * cg;
      const col2y = sa * sg - ca * sb * cg;
      const col2z = cb * cg;

      // Back vector = -(column 2)
      const bx = -col2x;
      const by = -col2y;
      const bz = -col2z;

      // Altitude: asin(bz)
      const altitude = Math.asin(Math.max(-1, Math.min(1, bz))) * (180 / Math.PI);
      // Azimuth: atan2(x, y) gives angle from north (y) toward east (x)
      let azimuth = Math.atan2(bx, by) * (180 / Math.PI);
      azimuth = norm360(azimuth);

      // If iOS gives us a proper compass heading, prefer it (it's corrected
      // for true north / geomagnetic drift).
      let absolute = e.absolute ?? false;
      if (typeof compassHeading === "number" && !isNaN(compassHeading)) {
        azimuth = compassHeading;
        absolute = true;
      }

      // Roll: column 1 of Rx*Ry = [0, cb, sb]; after Rz: [-sa*cb, ca*cb, sb]
      const up1x = -sa * cb;
      const up1y = ca * cb;
      const up1z = sb;

      // Column 0 of Rx*Ry: [cg, sb*sg, -cb*sg]
      // Rz applied: [ca*cg - sa*sb*sg, sa*cg + ca*sb*sg, -cb*sg]
      const rightx = ca * cg - sa * sb * sg;
      const righty = sa * cg + ca * sb * sg;
      const rightz = -cb * sg;

      // Screen-up after screen rotation = up * cos(-s) + right * sin(-s)
      const cs = Math.cos(-s), ss = Math.sin(-s);
      const sux = up1x * cs + rightx * ss;
      const suy = up1y * cs + righty * ss;
      const suz = up1z * cs + rightz * ss;

      // --- Roll ---------------------------------------------------------------
      // Roll is the signed angle by which the device's screen-up vector is
      // rotated, about the view (back) axis, away from the "reference up" the
      // renderer uses — world-up (the celestial z axis) projected onto the
      // plane perpendicular to the view direction. SkyMap rebuilds that exact
      // reference frame and then applies our `roll` as `rRad = -roll`, so the
      // value we emit here MUST be the negative of the screen-up's angle in
      // that frame for the rendered horizon to track the real one.
      //
      // Deriving roll from this reference frame (rather than the older
      // `atan2(sux*by - suy*bx, suz)` formula) fixes two things:
      //   1. The previous formula produced the wrong SIGN whenever the screen
      //      was physically tilted, so the rendered horizon rotated the wrong
      //      way during a pan instead of staying level ("chicken-head" stable).
      //   2. It degrades gracefully through the beta≈90° singularity (phone
      //      held upright), where Euler-derived roll is otherwise unstable.
      const viewX = bx, viewY = by, viewZ = bz;
      const dotVU = viewZ; // world-up · view = (0,0,1)·view = viewZ
      let refUpX = -viewX * dotVU;
      let refUpY = -viewY * dotVU;
      let refUpZ = 1 - viewZ * dotVU;
      let refLen = Math.hypot(refUpX, refUpY, refUpZ);
      if (refLen < 0.01) {
        // Looking straight up/down: fall back to north (0,1,0) as reference up,
        // matching SkyMap's identical fallback.
        const dotVN = viewY;
        refUpX = -viewX * dotVN;
        refUpY = 1 - viewY * dotVN;
        refUpZ = -viewZ * dotVN;
        refLen = Math.hypot(refUpX, refUpY, refUpZ) || 1;
      }
      refUpX /= refLen; refUpY /= refLen; refUpZ /= refLen;
      // refRight = view × refUp
      const refRightX = viewY * refUpZ - viewZ * refUpY;
      const refRightY = viewZ * refUpX - viewX * refUpZ;
      const refRightZ = viewX * refUpY - viewY * refUpX;
      // Components of screen-up in the (refUp, refRight) basis.
      const compUp = sux * refUpX + suy * refUpY + suz * refUpZ;
      const compRight = sux * refRightX + suy * refRightY + suz * refRightZ;
      // Screen-up's angle from refUp toward refRight is atan2(compRight, compUp).
      // SkyMap applies -roll, so negate to get the value that cancels the tilt.
      const roll = -Math.atan2(compRight, compUp) * (180 / Math.PI);

      // --- Smoothing --------------------------------------------------------
      const sm = smoothedRef.current;
      const alphaSm = Math.max(0.01, Math.min(1, smoothingRef.current));
      if (!sm.initialized) {
        sm.azimuth = azimuth;
        sm.altitude = altitude;
        sm.roll = roll;
        sm.initialized = true;
      } else {
        sm.azimuth = smoothAngle(sm.azimuth, azimuth, alphaSm);
        sm.altitude = sm.altitude + (altitude - sm.altitude) * alphaSm;
        sm.roll = smoothAngle(sm.roll, roll, alphaSm);
      }

      // First real event: flip into "active" so consumers know sensors work.
      if (!gotEventRef.current) {
        gotEventRef.current = true;
        setStatus("active");
      }

      setOrientation({
        azimuth: sm.azimuth,
        altitude: sm.altitude,
        roll: sm.roll,
        available: true,
        absolute,
      });
    };

    // Prefer the absolute event if available (gives true compass heading)
    const useAbsolute = "ondeviceorientationabsolute" in window;
    const eventName = useAbsolute ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName, handler as EventListener, true);
    return () => window.removeEventListener(eventName, handler as EventListener, true);
  }, []);

  // Guard against overlapping permission requests (e.g. one fired on
  // pan-start and another on pan-end of the same gesture) producing two
  // system prompts back to back.
  const permissionInFlightRef = useRef(false);

  /**
   * Request iOS motion permission. On iOS 13+ this MUST be called with
   * transient user activation — WebKit only grants that for events like
   * `pointerup` / `touchend` / `mousedown` / `keydown` (NOT `pointermove`
   * or `touchstart`). On other platforms this is a no-op that starts the
   * probe if we haven't already (we auto-probe on mount there anyway).
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    const DOE = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationEventIOS })
      .DeviceOrientationEvent;

    if (DOE && typeof DOE.requestPermission === "function") {
      if (permissionInFlightRef.current) return false;
      permissionInFlightRef.current = true;
      try {
        const result = await DOE.requestPermission();
        if (result === "granted") {
          // Kick off probing; the mount effect will attach listeners.
          setStatus((s) => (s === "active" ? "active" : "probing"));
          return true;
        } else {
          // The user saw the prompt and explicitly said no.
          setStatus("denied");
          return false;
        }
      } catch {
        // A rejection here is NOT a user denial — WebKit throws when the
        // call lacks transient user activation (or the context is
        // insecure). No prompt was ever shown, so leave the status alone
        // (normally "idle") so a later call from a gesture-qualified
        // event (pointerup etc.) can still succeed. Marking this "denied"
        // would strand the user behind a "turn it on in settings" banner
        // for a setting iOS 13+ no longer has.
        return false;
      } finally {
        permissionInFlightRef.current = false;
      }
    }
    // Non-iOS: nothing to grant. If we're still idle for some reason, move
    // to probing so the attach effect runs.
    setStatus((s) => (s === "idle" ? "probing" : s));
    return typeof window.DeviceOrientationEvent !== "undefined";
  }, []);

  // Attach listener + run a probe timer whenever we enter "probing".
  // If no event arrives within PROBE_TIMEOUT_MS we mark the sensor unavailable.
  useEffect(() => {
    if (status !== "probing") return;
    const detach = attachListener();
    const timerId = window.setTimeout(() => {
      if (!gotEventRef.current) {
        setStatus("unavailable");
      }
    }, PROBE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timerId);
      detach();
    };
  }, [status, attachListener]);

  // Keep the listener attached once sensors are active, too.
  useEffect(() => {
    if (status !== "active") return;
    const detach = attachListener();
    return detach;
  }, [status, attachListener]);

  return { orientation, status, requestPermission };
}
