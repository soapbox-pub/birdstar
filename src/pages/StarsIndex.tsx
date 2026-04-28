import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSeoMeta } from "@unhead/react";
import { useLocation, useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import {
  MapPin,
  Settings2,
  Sparkles,
  X as XIcon,
  Pencil,
  Undo2,
} from "lucide-react";

import {
  SkyMap,
  type CustomConstellationOverlay,
} from "@/components/SkyMap";
import { StarDetailSheet } from "@/components/StarDetailSheet";
import { MoonDetailSheet } from "@/components/MoonDetailSheet";
import { SunDetailSheet } from "@/components/SunDetailSheet";
import { PlanetDetailSheet } from "@/components/PlanetDetailSheet";
import { ConstellationDrawer } from "@/components/ConstellationDrawer";
import { ConstellationDetailSheet } from "@/components/ConstellationDetailSheet";
import { ProfileDetailSheet } from "@/components/ProfileDetailSheet";
import { ZodiacDetailSheet } from "@/components/ZodiacDetailSheet";
import { SkyStatusBanner, type SkyStatusBannerMessage } from "@/components/SkyStatusBanner";
import { EnableSensorsDialog } from "@/components/EnableSensorsDialog";
import { LoginArea } from "@/components/auth/LoginArea";
import { ModeSelector } from "@/components/ModeSelector";
import { useCustomConstellations } from "@/hooks/useCustomConstellations";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFollowList } from "@/hooks/useFollowList";
import { useOpenedView } from "@/hooks/useOpenedView";
import {
  CUSTOM_CONSTELLATION_KIND,
} from "@/lib/customConstellations";
import {
  ZODIAC_SIGNS,
  parseZodiacOverlayId,
  zodiacOverlayId,
} from "@/lib/zodiac";
import { useDeviceOrientation } from "@/hooks/useDeviceOrientation";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useWakeLock } from "@/hooks/useWakeLock";
import {
  EDIT_CONSTELLATION_EVENT,
  edgesToChain,
  type EditConstellationDetail,
} from "@/lib/editConstellationEvent";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { hapticTap, hapticTick } from "@/lib/haptics";
import { getEffectiveDeviceClass } from "@/lib/detectDevice";
import { cn } from "@/lib/utils";

/**
 * How community (user-drawn) constellations are surfaced on the sky.
 *
 * - `"none"`: hide them entirely.
 * - `"follows"`: only show constellations authored by accounts the
 *   logged-in user follows (kind 3 contact list). Falls back to nothing
 *   if the user isn't logged in.
 * - `"everyone"`: show every community constellation the relay returns.
 */
export type CommunityConstellationMode = "none" | "follows" | "everyone";

/** Shortest signed delta b - a in degrees, range (-180, 180] */
function angleDelta(a: number, b: number): number {
  let d = ((b - a + 540) % 360) - 180;
  if (d <= -180) d += 360;
  return d;
}

const Index = () => {
  useSeoMeta({
    title: "Birdstar — Go outside. Find the birds. Draw the stars.",
    description:
      "Point your phone at the sky to identify stars and constellations in real time.",
    ogImageAlt:
      "A hand holds a phone pointed up at a starry night sky with faint constellation lines traced between stars.",
    twitterCard: "summary_large_image",
  });

  // Smoothing controls how jittery raw sensors look. 0.25 is a nice default:
  // responsive, but visibly damps hand tremor.
  const [smoothing] = useLocalStorage<number>("starpoint:smoothing", 0.22);

  const {
    orientation,
    status: orientationStatus,
    requestPermission,
  } = useDeviceOrientation({ smoothing });
  const { coords, status: geoStatus, request: requestGeo, setManual } = useGeolocation();

  const [showNames, setShowNames] = useLocalStorage("starpoint:showNames", true);
  const [fov, setFov] = useLocalStorage<number>("starpoint:fov", 75);
  // The 12 built-in zodiac (astrological) constellations ride the same
  // rendering channel as user-drawn ones but are toggled as a single
  // group in Settings. Default on: the feature's the whole point, and
  // users who don't want them can disable in one tap.
  const [showZodiac, setShowZodiac] = useLocalStorage<boolean>(
    "starpoint:showZodiac",
    true,
  );
  // Community (user-drawn) constellations are filtered globally by a
  // single tri-state setting rather than per-constellation toggles.
  // Default `"everyone"` keeps the feature discoverable out of the box.
  const [communityMode, setCommunityMode] =
    useLocalStorage<CommunityConstellationMode>(
      "starpoint:communityMode",
      "everyone",
    );

  const [enableSensorsOpen, setEnableSensorsOpen] = useState(false);

  // --- URL-driven view state ---------------------------------------------
  //
  // "Which overlay is open" lives entirely in the URL now. `useOpenedView`
  // parses the current route (e.g. `/star/32349`, `/zodiac/leo`,
  // `/naddr1…`) into a discriminated union we can render from directly.
  //
  // Navigation helpers below wrap `useNavigate` to keep SkyMap's click
  // callbacks one-liners.
  const navigate = useNavigate();
  const location = useLocation();
  const opened = useOpenedView();

  /**
   * Close any open overlay. Prefer stepping back through the user's
   * history (keeps the "cross-drawer navigation" chain intact); if
   * this is the first page they loaded, fall back to the root sky URL.
   */
  const closeOverlay = useCallback(() => {
    // `location.key === 'default'` means the user landed here directly;
    // there's no history to pop, so just go home.
    if (location.key === "default") {
      navigate("/");
    } else {
      navigate(-1);
    }
  }, [navigate, location.key]);

  // --- Custom constellations state -------------------------------------
  const [showConstellationDrawer, setShowConstellationDrawer] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingStars, setDrawingStars] = useState<number[]>([]);

  const { user } = useCurrentUser();
  const { data: allCustomConstellations } = useCustomConstellations();
  // Follow list is only consulted when the user picked "follows" mode.
  // The hook itself is gated on having a logged-in user, so when nobody
  // is signed in it stays idle.
  const { data: followList } = useFollowList();

  // Build the overlays to pass into the sky map.
  //
  // Built-in zodiac signs are prepended as their own variant when the
  // Settings toggle is on. Community constellations are filtered by the
  // `communityMode` setting: `"none"` hides them all, `"follows"` keeps
  // only those authored by accounts the user follows, and `"everyone"`
  // shows every constellation the relay returned.
  const customOverlays = useMemo<CustomConstellationOverlay[]>(() => {
    const overlays: CustomConstellationOverlay[] = [];

    if (showZodiac) {
      for (const z of ZODIAC_SIGNS) {
        overlays.push({
          id: zodiacOverlayId(z.id),
          title: z.name,
          edges: z.edges.map(([a, b]) => [a, b] as [number, number]),
          variant: "zodiac",
          highlight: false,
        });
      }
    }

    if (communityMode !== "none" && allCustomConstellations) {
      // `"follows"` with no logged-in user (or an empty/missing follow
      // list) yields no community overlays — consistent with the
      // dropdown's intent.
      const allow: ((c: { pubkey: string }) => boolean) | null =
        communityMode === "follows"
          ? (c) => !!user && !!followList && followList.has(c.pubkey)
          : null;

      for (const c of allCustomConstellations) {
        if (allow && !allow(c)) continue;
        overlays.push({
          id: `${c.pubkey}:${c.d}`,
          title: c.title,
          edges: c.edges,
          highlight: false,
        });
      }
    }
    return overlays;
  }, [allCustomConstellations, showZodiac, communityMode, user, followList]);

  // Listen for the bulk-set event fired by the drawer when the user
  // chooses to edit an existing constellation.
  useEffect(() => {
    const onSet = (e: Event) => {
      const detail = (e as CustomEvent<number[]>).detail;
      if (
        Array.isArray(detail) &&
        detail.every((n) => typeof n === "number" && Number.isFinite(n))
      ) {
        setDrawingStars(detail);
      }
    };
    window.addEventListener("starpoint:set-drawing-stars", onSet);
    return () =>
      window.removeEventListener("starpoint:set-drawing-stars", onSet);
  }, []);

  // Cross-component "edit this constellation" handler. Dispatched by
  // the constellation drawer and the profile sheet; we handle the
  // Index-owned side of editing here (opening the drawer, entering
  // drawing mode, populating the stars). The drawer itself listens
  // for the same event to fill its title/description form. See
  // `src/lib/editConstellationEvent.ts` for the event contract.
  useEffect(() => {
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<EditConstellationDetail>).detail;
      if (!detail || !Array.isArray(detail.edges)) return;
      setDrawingStars(edgesToChain(detail.edges));
      setDrawingMode(true);
      setShowConstellationDrawer(true);
      // If we were deep-linked into a profile or constellation, hop
      // back to the sky so the user can actually see/tap stars.
      if (location.pathname !== "/") navigate("/");
    };
    window.addEventListener(EDIT_CONSTELLATION_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_CONSTELLATION_EVENT, onEdit);
  }, [navigate, location.pathname]);

  // --- Unified view state ------------------------------------------------
  //
  // The sky view has a single source of truth: `view`, holding azimuth,
  // altitude, and roll in degrees. Two inputs can drive it:
  //
  //   1. Live orientation sensors (when they're producing data).
  //   2. User drag gestures on the canvas.
  //
  // Sensor → view sync is gated by two pieces of state:
  //
  //   - `isPanningRef`: true from the moment a deliberate single-finger
  //     pan crosses the drag threshold until the finger lifts. While it
  //     is true, the sensor is completely locked out — the user's finger
  //     is the single source of truth. Critically, *pinch-to-zoom is not
  //     a pan*, so it never sets this flag.
  //
  //   - `userHoldUntilRef`: a timestamp used on sensor-less devices to
  //     pin the view wherever the user last dragged it for a few seconds.
  //     When sensors are active we don't hold at all: instead we smoothly
  //     animate the view back onto the live sensor reading the moment the
  //     user lifts their finger (see `snapAnimRef` / `tickSnapBack`).
  //
  // On devices without sensors (most desktops) the view just stays
  // wherever the user last dragged it — there's no separate "manual mode".
  const [view, setView] = useState<{ azimuth: number; altitude: number; roll: number }>(
    () => ({ azimuth: 0, altitude: 30, roll: 0 }),
  );
  // True while a deliberate single-finger pan is in progress. Blocks the
  // sensor-sync effect below so mid-pan sensor ticks don't fight the user.
  const isPanningRef = useRef<boolean>(false);
  // On sensor-less devices, after a pan ends we still want the view to
  // stay put for a short window. Populated only when sensors are off; on
  // sensor-equipped devices we snap back immediately on finger-up.
  const userHoldUntilRef = useRef<number>(0);
  const USER_HOLD_MS = 3000;
  // Handle for an in-flight "snap the view back onto the sensor" rAF
  // animation. While this is non-null the sensor-sync effect is also
  // suppressed — the animation itself reads the latest sensor values each
  // frame and drives the view toward them smoothly.
  const snapAnimRef = useRef<number | null>(null);

  // Keep the latest sensor reading in a ref so the snap-back animation
  // loop (which is a plain rAF, not a React effect) can always see the
  // freshest values without us having to tear it down and rebuild it on
  // every sensor tick.
  const sensorRef = useRef({
    azimuth: orientation.azimuth,
    altitude: orientation.altitude,
    roll: orientation.roll,
    available: orientation.available,
  });
  useEffect(() => {
    sensorRef.current = {
      azimuth: orientation.azimuth,
      altitude: orientation.altitude,
      roll: orientation.roll,
      available: orientation.available,
    };
  }, [orientation.azimuth, orientation.altitude, orientation.roll, orientation.available]);

  const cancelSnapBack = useCallback(() => {
    if (snapAnimRef.current != null) {
      cancelAnimationFrame(snapAnimRef.current);
      snapAnimRef.current = null;
    }
  }, []);

  // Smooth exponential chase from the current view toward the live sensor
  // reading. The sensor itself is still moving (the phone is in the user's
  // hand), so each frame we re-read `sensorRef` and step a fraction of
  // the way there. Once we're within a hair of the sensor on all three
  // axes we stop and hand control back to the direct sensor-sync effect.
  const startSnapBack = useCallback(() => {
    cancelSnapBack();
    // Per-frame lerp factor. Higher = snappier; lower = lazier. Picked by
    // feel: at 60fps this reaches ~95% of the target in ~250ms.
    const ALPHA = 0.18;
    // When all three axes are this close to the sensor (in degrees) we
    // call it converged and stop animating.
    const DONE_EPSILON = 0.25;
    const tick = () => {
      snapAnimRef.current = null;
      const s = sensorRef.current;
      if (!s.available) return; // sensor went away mid-animation; bail.
      if (isPanningRef.current) return; // user grabbed again; bail.
      let done = false;
      setView((v) => {
        const dAz = angleDelta(v.azimuth, s.azimuth);
        const dAlt = s.altitude - v.altitude;
        const dRoll = angleDelta(v.roll, s.roll);
        if (
          Math.abs(dAz) < DONE_EPSILON &&
          Math.abs(dAlt) < DONE_EPSILON &&
          Math.abs(dRoll) < DONE_EPSILON
        ) {
          // Snap exactly onto the sensor so the handoff to the direct
          // sensor effect is seamless (no visible jump).
          done = true;
          return { azimuth: s.azimuth, altitude: s.altitude, roll: s.roll };
        }
        let az = v.azimuth + dAz * ALPHA;
        az = ((az % 360) + 360) % 360;
        let alt = v.altitude + dAlt * ALPHA;
        if (alt > 90) alt = 90;
        if (alt < -90) alt = -90;
        const roll = v.roll + dRoll * ALPHA;
        return { azimuth: az, altitude: alt, roll };
      });
      if (!done) {
        snapAnimRef.current = requestAnimationFrame(tick);
      }
    };
    snapAnimRef.current = requestAnimationFrame(tick);
  }, [cancelSnapBack]);

  // Sync the view from sensor readings when neither a pan nor a snap-back
  // animation is active. On sensor-less devices also honour the post-pan
  // hold window (keeps the view parked where the user dragged it).
  useEffect(() => {
    if (!orientation.available) return;
    if (isPanningRef.current) return;
    if (snapAnimRef.current != null) return;
    if (Date.now() < userHoldUntilRef.current) return;
    setView({
      azimuth: orientation.azimuth,
      altitude: orientation.altitude,
      roll: orientation.roll,
    });
  }, [orientation.azimuth, orientation.altitude, orientation.roll, orientation.available]);

  // Clean up any in-flight snap-back animation on unmount.
  useEffect(() => {
    return () => {
      if (snapAnimRef.current != null) {
        cancelAnimationFrame(snapAnimRef.current);
      }
    };
  }, []);

  const { azimuth, altitude, roll } = view;

  // Keep the screen awake while the user is on the sky view.
  useWakeLock(true);

  // Auto-request geolocation on mount so users don't have to fish for a
  // button to get accurate sky computation. The browser will show its own
  // permission prompt; declined or errored cases are handled by the status
  // banner below (location defaults from cache or falls back to NYC).
  const triedGeoRef = useRef(false);
  useEffect(() => {
    if (triedGeoRef.current) return;
    if (geoStatus === "idle") {
      triedGeoRef.current = true;
      requestGeo();
    }
  }, [geoStatus, requestGeo]);

  // Pan handler — called while the user drags on the sky canvas. We just
  // apply the delta to view-state; the sensor is held off by
  // `isPanningRef` (set in handlePanStart below) so no timestamp juggling
  // is required here.
  //
  // The deltas come from SkyMap's 3D-rotation pan math, which already
  // takes the shortest path around poles (dragging past the zenith flips
  // azimuth by 180° and sends altitude back down smoothly). Azimuth is
  // wrapped to [0, 360); altitude is clamped purely as a floating-point
  // safety net — by construction the computed deltas can't push it past
  // the pole.
  const handlePan = useCallback((dAz: number, dAlt: number) => {
    setView((v) => {
      let az = v.azimuth + dAz;
      az = ((az % 360) + 360) % 360;
      let alt = v.altitude + dAlt;
      if (alt > 90) alt = 90;
      if (alt < -90) alt = -90;
      return { azimuth: az, altitude: alt, roll: v.roll };
    });
  }, []);

  // On the very first drag, if iOS needs a motion permission prompt, fire
  // it now — we satisfy the user-gesture requirement without any modal.
  // If the user denies we fall through to the banner below; if they allow,
  // the sensor will take over once the user lifts their finger.
  //
  // We also flip `isPanningRef` on so the sensor-sync effect stops
  // fighting the user for the duration of the drag, and cancel any
  // in-flight snap-back animation from a previous gesture.
  const permissionRequestedRef = useRef(false);
  const handlePanStart = useCallback(() => {
    isPanningRef.current = true;
    cancelSnapBack();
    if (permissionRequestedRef.current) return;
    if (orientationStatus === "idle") {
      permissionRequestedRef.current = true;
      // Fire and forget — we don't need to await. The hook updates its
      // status synchronously from the event, and the mount-time probe
      // effect handles attaching the listener.
      void requestPermission();
    }
  }, [cancelSnapBack, orientationStatus, requestPermission]);

  // Finger-up (or pan aborted because it turned into a pinch).
  //
  // - `canceled: true` means the gesture morphed into a pinch-zoom. We
  //   must NOT treat that as a deliberate pan: no cooldown, no snap-back
  //   kickoff (sensors can resume immediately on the next tick).
  //
  // - Normal finger-up with sensors active: smoothly animate the view
  //   back onto the live sensor reading. No 3-second cooldown — the user
  //   wants the sky to follow their phone again, not drift for 3s first.
  //
  // - Normal finger-up without sensors: park the view for a few seconds
  //   via the timestamp window (historical behaviour on desktop where
  //   `orientation.available` is false anyway).
  const handlePanEnd = useCallback(
    (opts?: { canceled?: boolean }) => {
      isPanningRef.current = false;
      if (opts?.canceled) return;
      if (sensorRef.current.available) {
        startSnapBack();
      } else {
        userHoldUntilRef.current = Date.now() + USER_HOLD_MS;
      }
    },
    [startSnapBack],
  );

  // Build the list of status banners to show over the sky.
  //
  // The copy and calls-to-action are tailored to what we can guess about
  // the user's device. A `denied` orientation status is strong evidence
  // that the device has motion sensors (you can only deny what exists),
  // so we treat those users as phone users and offer actionable help. On
  // traditional computers we keep quiet beyond a dismissible one-time tip
  // nudging them toward using a phone for the full experience.
  const statusMessages = useMemo<SkyStatusBannerMessage[]>(() => {
    const msgs: SkyStatusBannerMessage[] = [];
    const deviceClass = getEffectiveDeviceClass(orientationStatus);

    if (orientationStatus === "denied") {
      // Denied implies sensors exist. Always treat as a phone and offer
      // a concrete way to fix it.
      msgs.push({
        id: "orientation-denied",
        icon: "compass",
        tone: "warning",
        title: "Turn on motion access",
        description:
          "Birdstar uses your phone's motion to match the sky to where you're looking.",
        action: {
          label: "Enable sensors",
          onClick: () => setEnableSensorsOpen(true),
        },
        dismissPersist: false,
      });
    } else if (orientationStatus === "unavailable") {
      // Sensors aren't reporting. On a traditional computer this is the
      // norm, so we keep it to a gentle one-time tip suggesting phone
      // usage. On a phone that somehow isn't producing events we drop
      // the phone-usage suggestion (they're already on a phone) but
      // still surface the drag affordance.
      msgs.push({
        id: "drag-to-look-around",
        icon: "compass",
        title: "Drag to look around",
        description:
          deviceClass === "phone"
            ? "Move the sky by dragging."
            : "For the full experience, open Birdstar on your phone.",
        dismissPersist: true,
      });
    }

    if (
      geoStatus === "denied" ||
      geoStatus === "error" ||
      geoStatus === "unsupported"
    ) {
      msgs.push({
        id: `geo-${geoStatus}`,
        icon: "map-pin",
        tone: geoStatus === "denied" ? "warning" : "info",
        title: "Add your location",
        description:
          "Stars depend on where you are. Using a default for now — set your location in Settings for an accurate sky.",
        action: { label: "Retry", onClick: requestGeo },
        dismissPersist: false,
      });
    }
    return msgs;
  }, [orientationStatus, geoStatus, requestGeo]);

  return (
    <div className="fixed inset-0 w-screen h-screen bg-black text-white overflow-hidden select-none">
      {/* Sky canvas */}
      <SkyMap
        latitude={coords.latitude}
        longitude={coords.longitude}
        azimuth={azimuth}
        altitude={altitude}
        roll={roll}
        fov={fov}
        showNames={showNames}
        customConstellations={customOverlays}
        drawingMode={drawingMode}
        drawingStars={drawingStars}
        onSelectStar={(s) => {
          hapticTap();
          if (drawingMode) {
            setDrawingStars((prev) => {
              // Avoid immediate duplicates (same star twice in a row).
              if (prev[prev.length - 1] === s.hip) return prev;
              return [...prev, s.hip];
            });
          } else {
            navigate(`/star/${s.hip}`);
          }
        }}
        onSelectConstellation={(id) => {
          hapticTap();
          // Zodiac overlays share the constellation hit-test channel but
          // open a different, astrology-focused sheet. We distinguish by
          // id prefix (`zodiac:<sign>`); anything else is a user-drawn
          // constellation.
          const zid = parseZodiacOverlayId(id);
          if (zid) {
            navigate(`/zodiac/${zid}`);
            return;
          }
          // Tapping a user-drawn constellation navigates to its naddr
          // URL. Global visibility is now controlled by the community
          // mode dropdown in Settings; no per-constellation state to
          // nudge here.
          const sep = id.indexOf(":");
          if (sep <= 0) return;
          const pubkey = id.slice(0, sep);
          const d = id.slice(sep + 1);
          const naddr = nip19.naddrEncode({
            kind: CUSTOM_CONSTELLATION_KIND,
            pubkey,
            identifier: d,
          });
          navigate(`/${naddr}`);
        }}
        onSelectMoon={() => {
          hapticTap();
          navigate("/moon");
        }}
        onSelectSun={() => {
          hapticTap();
          navigate("/sun");
        }}
        onSelectPlanet={(id) => {
          hapticTap();
          navigate(`/planet/${id}`);
        }}
        onFovChange={setFov}
        onPan={handlePan}
        onPanStart={handlePanStart}
        onPanEnd={handlePanEnd}
        minFov={20}
        maxFov={280}
      />

      {/* Top HUD — mode selector on the left, auth/constellations/
          settings on the right. Two separate absolutely-positioned
          groups so they hug their own edges without tangling on
          narrower phones. */}
      <div className="pointer-events-none absolute top-0 left-0 p-4 flex items-center gap-2">
        <div className="pointer-events-auto">
          <ModeSelector />
        </div>
      </div>
      <div className="pointer-events-none absolute top-0 right-0 p-4 flex items-center justify-end gap-2">
        <div className="pointer-events-auto">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowConstellationDrawer(true)}
            className={cn(
              "rounded-full backdrop-blur-md border-white/10 text-white",
              drawingMode
                ? "bg-amber-300/20 border-amber-200/40 hover:bg-amber-300/30 text-amber-100"
                : "bg-black/40 hover:bg-black/60 hover:text-white",
            )}
            aria-label="Custom constellations"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>
        <div className="pointer-events-auto">
          <LoginArea
            className={[
              // Shared pill shape for both the logged-out "Join" button and
              // the logged-in AccountSwitcher trigger.
              "[&>button]:h-10 [&>button]:rounded-full",
              "[&>button]:bg-black/40 [&>button]:backdrop-blur-md",
              "[&>button]:border [&>button]:border-white/10 [&>button]:text-white",
              "hover:[&>button]:bg-black/60",
              // Logged-in: AccountSwitcher trigger contains an Avatar span
              // (data-slot="avatar"). Compress padding so the 32px avatar
              // sits flush and hide the chevron div on this compact HUD.
              "[&>button:has(>[data-slot=avatar])]:p-1",
              "[&>button:has(>[data-slot=avatar])]:pr-2.5",
              "[&>button:has(>[data-slot=avatar])]:gap-2",
              "[&>button>[data-slot=avatar]]:h-8",
              "[&>button>[data-slot=avatar]]:w-8",
              "[&>button:has(>[data-slot=avatar])>div]:hidden",
              // Logged-out: "Join" button has a plain <span> label child, so
              // give it horizontal padding for the label to breathe.
              "[&>button:not(:has(>[data-slot=avatar]))]:px-5",
              // AuthDialog portaled triggers (when rendered as siblings).
              "[&>div>button]:h-9 [&>div>button]:px-3.5 [&>div>button]:text-xs",
              "[&>div>button]:rounded-full",
            ].join(" ")}
          />
        </div>
        <div className="pointer-events-auto">
          <SettingsSheet
            showNames={showNames}
            setShowNames={setShowNames}
            showZodiac={showZodiac}
            setShowZodiac={setShowZodiac}
            communityMode={communityMode}
            setCommunityMode={setCommunityMode}
            fov={fov}
            setFov={setFov}
            latitude={coords.latitude}
            longitude={coords.longitude}
            onSetLocation={(lat, lon) => setManual({ latitude: lat, longitude: lon })}
            geoStatus={geoStatus}
            onRequestGeo={requestGeo}
          />
        </div>
      </div>

      {/* Non-blocking status banners (sensor denied, no location, etc.) */}
      <SkyStatusBanner messages={statusMessages} />

      {/* Instructions dialog for re-enabling denied motion permission. */}
      <EnableSensorsDialog
        open={enableSensorsOpen}
        onOpenChange={setEnableSensorsOpen}
      />

      {/* Selected star detail sheet with Wikipedia & Nostr comments */}
      <StarDetailSheet
        star={opened.kind === "star" ? opened.star : null}
        onClose={closeOverlay}
      />

      {/* Moon detail sheet — opened by tapping the Moon disk on the sky. */}
      <MoonDetailSheet
        open={opened.kind === "moon"}
        onClose={closeOverlay}
      />

      {/* Sun detail sheet — opened by tapping the Sun disk on the sky. */}
      <SunDetailSheet
        open={opened.kind === "sun"}
        onClose={closeOverlay}
        latitude={coords.latitude}
        longitude={coords.longitude}
      />

      {/* Planet detail sheet — opened by tapping any of the seven planets
          on the sky. One sheet serves every planet; its identity is
          driven by the URL (`/planet/:planetId`). */}
      <PlanetDetailSheet
        planetId={opened.kind === "planet" ? opened.id : null}
        onClose={closeOverlay}
        latitude={coords.latitude}
        longitude={coords.longitude}
      />

      {/* Tapped constellation detail sheet with description & Nostr comments */}
      <ConstellationDetailSheet
        constellation={
          opened.kind === "constellation" ? opened.constellation : null
        }
        onClose={closeOverlay}
      />

      {/* Profile sheet — opened when the URL resolves to an npub or
          nprofile. Shows the author's avatar, bio, and published
          constellations; owned constellations get an Edit/Delete menu. */}
      <ProfileDetailSheet
        pubkey={opened.kind === "profile" ? opened.pubkey : null}
        onClose={closeOverlay}
      />

      {/* Built-in zodiac (astrology) sign detail sheet. Opened by tapping
          any of the twelve zodiac figures on the sky. Visibility is
          controlled globally from Settings, not per sign. */}
      <ZodiacDetailSheet
        sign={opened.kind === "zodiac" ? opened.sign : null}
        onClose={closeOverlay}
      />

      {/* Drawing-mode floating HUD. Shown while the user is picking stars
          and the drawer is closed, so they can see progress and abort. */}
      {drawingMode && !showConstellationDrawer && (
        <DrawingModeBanner
          starCount={drawingStars.length}
          onOpenDrawer={() => setShowConstellationDrawer(true)}
          onUndo={() => {
            setDrawingStars((prev) => prev.slice(0, -1));
            hapticTick();
          }}
          onCancel={() => {
            setDrawingMode(false);
            setDrawingStars([]);
          }}
        />
      )}

      {/* Custom constellations drawer */}
      <ConstellationDrawer
        open={showConstellationDrawer}
        onOpenChange={setShowConstellationDrawer}
        drawingMode={drawingMode}
        drawingStars={drawingStars}
        onStartDrawing={() => {
          setDrawingMode(true);
          // Closing the drawer lets the user actually tap the sky.
          setShowConstellationDrawer(false);
        }}
        onCancelDrawing={() => {
          setDrawingMode(false);
          setDrawingStars([]);
        }}
        onUndoStar={() => {
          setDrawingStars((prev) => prev.slice(0, -1));
          hapticTick();
        }}
        onClearStars={() => setDrawingStars([])}
        onFinishDrawing={() => setShowConstellationDrawer(false)}
      />
    </div>
  );
};

/**
 * Floating banner shown while the user is drawing a constellation and the
 * drawer is closed. Gives them quick access to undo / finish / cancel
 * without having to re-open the full drawer.
 */
function DrawingModeBanner({
  starCount,
  onOpenDrawer,
  onUndo,
  onCancel,
}: {
  starCount: number;
  onOpenDrawer: () => void;
  onUndo: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 w-[min(92vw,480px)] px-2">
      <div className="pointer-events-auto rounded-2xl border border-amber-200/40 bg-amber-300/10 backdrop-blur-md px-4 py-2.5 shadow-lg flex items-center gap-3">
        <div className="h-8 w-8 rounded-xl bg-amber-300 text-slate-900 flex items-center justify-center shrink-0">
          <Pencil className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-amber-100">
            Drawing a constellation
          </div>
          <div className="text-[11px] text-amber-100/70">
            Tap stars to connect them · {starCount} picked
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onUndo}
            disabled={starCount === 0}
            className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 flex items-center justify-center"
            aria-label="Undo last star"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onOpenDrawer}
            className="h-8 px-3 rounded-full bg-amber-300 hover:bg-amber-200 text-slate-900 text-xs font-semibold flex items-center"
          >
            Finish
          </button>
          <button
            onClick={onCancel}
            className="h-8 w-8 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-100 flex items-center justify-center"
            aria-label="Cancel drawing"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsSheet({
  showNames,
  setShowNames,
  showZodiac,
  setShowZodiac,
  communityMode,
  setCommunityMode,
  fov,
  setFov,
  latitude,
  longitude,
  onSetLocation,
  geoStatus,
  onRequestGeo,
}: {
  showNames: boolean;
  setShowNames: (v: boolean) => void;
  showZodiac: boolean;
  setShowZodiac: (v: boolean) => void;
  communityMode: CommunityConstellationMode;
  setCommunityMode: (v: CommunityConstellationMode) => void;
  fov: number;
  setFov: (v: number) => void;
  latitude: number;
  longitude: number;
  onSetLocation: (lat: number, lon: number) => void;
  geoStatus: string;
  onRequestGeo: () => void;
}) {
  const [latInput, setLatInput] = useState(latitude.toFixed(4));
  const [lonInput, setLonInput] = useState(longitude.toFixed(4));

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-black/40 backdrop-blur-md border-white/10 text-white hover:bg-black/60 hover:text-white"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="bg-slate-950/95 border-white/10 text-white backdrop-blur-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-white">Settings</SheetTitle>
          <SheetDescription className="text-white/60">
            Customize your sky view and location.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-6 mt-6 px-4 pb-4">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">
              Display
            </h3>
            <Toggle label="Star names" checked={showNames} onChange={setShowNames} />
            <Toggle
              label="Zodiac signs"
              checked={showZodiac}
              onChange={setShowZodiac}
            />
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm text-white/80">
                Community constellations
              </Label>
              <Select
                value={communityMode}
                onValueChange={(v) =>
                  setCommunityMode(v as CommunityConstellationMode)
                }
              >
                <SelectTrigger className="h-9 w-[140px] bg-white/5 border-white/10 text-white data-placeholder:text-white/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-950/95 border-white/10 text-white backdrop-blur-lg">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="follows">Follows</SelectItem>
                  <SelectItem value="everyone">Everyone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-sm text-white/80">Field of view</Label>
                <span className="text-xs tabular-nums text-white/60">{fov}°</span>
              </div>
              <Slider
                value={[fov]}
                onValueChange={(v) => setFov(v[0])}
                min={20}
                max={280}
                step={1}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-white/50">
              Location
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-white/70">Latitude</Label>
                <Input
                  value={latInput}
                  onChange={(e) => setLatInput(e.target.value)}
                  className="bg-white/5 border-white/10 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-white/70">Longitude</Label>
                <Input
                  value={lonInput}
                  onChange={(e) => setLonInput(e.target.value)}
                  className="bg-white/5 border-white/10 text-white mt-1"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
                onClick={() => {
                  const lat = parseFloat(latInput);
                  const lon = parseFloat(lonInput);
                  if (!isNaN(lat) && !isNaN(lon)) onSetLocation(lat, lon);
                }}
              >
                Set manually
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 bg-white/5 border-white/10 hover:bg-white/10 text-white hover:text-white"
                onClick={onRequestGeo}
              >
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                Use GPS
              </Button>
            </div>
            {geoStatus === "denied" && (
              <p className="text-xs text-rose-300">
                Location permission denied — set coordinates manually.
              </p>
            )}
          </section>

          <div className="pt-4 border-t border-white/10 flex flex-col items-center gap-2">
            <a
              href="https://shakespeare.diy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
            >
              Vibed with Shakespeare
            </a>
            <a
              href="https://gitlab.com/soapbox-pub/birdstar"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
            >
              Source code · AGPL-3.0
            </a>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm text-white/80 cursor-pointer">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export default Index;
