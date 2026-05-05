import { useEffect, useRef, useState } from "react";
import { SkyMap } from "@/components/SkyMap";
import { useGeolocation } from "@/hooks/useGeolocation";

/**
 * Ambient, non-interactive starfield that sits behind the app. Reuses
 * the same `<SkyMap>` canvas renderer as Stars mode so the two
 * experiences share a single visual language — but strips every
 * interaction:
 *
 * - Wrapper is `pointer-events-none`, so clicks pass through to the
 *   real UI layer (Birds tiles, the interactive Stars SkyMap, whatever
 *   chrome is mounted above).
 * - No `onSelect*` / `onPan*` / `onFovChange` handlers are passed, so
 *   the SkyMap's internal gesture code has nowhere to route deltas and
 *   stays inert.
 * - Azimuth drifts slowly so the sky doesn't look frozen, unless the
 *   user prefers reduced motion (matchMedia), in which case it holds
 *   still.
 *
 * Reads the cached geolocation (if any) but never prompts — the real
 * Stars page owns that UX.
 */
export function SkyBackdrop({ hidden = false }: { hidden?: boolean }) {
  const { coords } = useGeolocation();
  const [azimuth, setAzimuth] = useState(180);

  // Slow rotation for ambience. 360° / ~3 minutes ≈ 2°/sec;
  // we step every animation frame for smooth motion.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (hidden) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    // Degrees per millisecond. A full rotation in ~6 minutes: calm
    // enough to feel atmospheric rather than carousel-like.
    const DEG_PER_MS = 360 / (6 * 60 * 1000);
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setAzimuth((a) => (a + DEG_PER_MS * dt) % 360);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [hidden]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 bg-black"
      // `hidden` is used to suspend expensive canvas work while the
      // backdrop is fully faded out (Birds light mode). We keep the
      // element mounted so re-enter doesn't remount the whole SkyMap;
      // we just stop rendering children.
    >
      {hidden ? null : (
        <SkyMap
          latitude={coords.latitude}
          longitude={coords.longitude}
          azimuth={azimuth}
          altitude={35}
          roll={0}
          fov={120}
          showNames={false}
        />
      )}
    </div>
  );
}
