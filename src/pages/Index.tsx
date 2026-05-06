import { useEffect, useState } from "react";
import { useMode } from "@/hooks/useMode";
import { useIsDark } from "@/hooks/useIsDark";
import { ForceDarkTheme } from "@/components/ForceDarkTheme";
import { LocationDisabledIndicator } from "@/components/LocationDisabledIndicator";
import { SkyBackdrop } from "@/components/SkyBackdrop";
import BirdsIndex from "./BirdsIndex";
import StarsIndex from "./StarsIndex";

/**
 * How long the cross-fade between Birds and Stars lasts. Long enough
 * for the eye to register the swap as a transition rather than a jump
 * cut, short enough that nobody's waiting on it. Applied via inline
 * `transitionDuration` so the value stays in one place (Tailwind's
 * scanner can't see dynamic class strings like `duration-[${n}ms]`).
 */
const TRANSITION_MS = 600;

const fadeStyle = (visible: boolean): React.CSSProperties => ({
  transitionProperty: "opacity",
  transitionDuration: `${TRANSITION_MS}ms`,
  transitionTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1)",
  opacity: visible ? 1 : 0,
});

type Mode = "birds" | "stars";

/**
 * Wrapper that fades its children in on mount and out when `visible`
 * flips to false. The fade-in is the key move: a freshly mounted div
 * gets no CSS transition if its very first render has `opacity: 1`
 * (there's no "previous value" for the browser to animate from), so
 * we mount at 0, then on the next paint frame flip to the real target
 * value. That gives a clean 0 → 1 transition in exactly the same
 * duration as the outgoing layer's 1 → 0, producing a true cross-fade
 * in both directions.
 *
 * Without this, the direction Birds → Stars feels abrupt even though
 * Stars → Birds feels smooth — because the incoming layer renders
 * *above* the outgoing layer in DOM order and pops in at full opacity
 * regardless of the outgoing layer's fade-out animation.
 */
function ModeLayer({
  visible,
  initiallyVisible = false,
  children,
}: {
  visible: boolean;
  /**
   * Skip the 0 → 1 mount-time fade-in. Used for the mode that is
   * rendered on initial page load (there's no "previous state" to
   * transition from; users would just see a 600ms fade from black
   * every time they visit).
   */
  initiallyVisible?: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(initiallyVisible);
  useEffect(() => {
    if (mounted) return;
    // Flip from initial opacity 0 to the real target on the next
    // paint frame. Two chained rAFs are needed because a single rAF
    // callback fires *before* the frame's paint, so we set the style
    // for the current (still-0) frame; the second rAF runs after that
    // frame has painted, when setting opacity to 1 will actually
    // trigger a transition.
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setMounted(true));
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
    };
  }, [mounted]);

  return (
    <div
      style={{
        ...fadeStyle(mounted && visible),
        pointerEvents: visible ? undefined : "none",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Top-level dispatcher. Reads the current {@link useMode.mode} and
 * renders the matching experience with a shared starry backdrop that
 * both modes sit on top of:
 *
 *   - **Stars mode:** the interactive `<SkyMap>` in `StarsIndex`
 *     paints its own opaque night sky, which covers the shared
 *     backdrop. We still mount the backdrop during transitions so
 *     the fade has a continuous starry substrate.
 *   - **Dark Birds mode:** the shared backdrop is *the* visible sky;
 *     the partially-transparent indigo gradient sits on top of it.
 *   - **Light Birds mode:** backdrop is hidden (the canvas unmounts)
 *     and the opaque daytime gradient covers everything.
 *
 * When the user flips the mode toggle, both Birds and Stars trees
 * are mounted simultaneously for ~{@link TRANSITION_MS}ms and their
 * opacities are cross-faded by {@link ModeLayer}. Because the starry
 * backdrop is shared, the sky stays rock-steady through the swap —
 * only the chrome (header, tiles, HUD, gradients) dissolves in and
 * out, giving the app a single continuous visual identity.
 *
 * `ForceDarkTheme` is mounted for the whole window that Stars is in
 * `mountedModes` — from the moment a transition *toward* Stars starts,
 * staying mounted through a fade *out* of Stars until StarsIndex
 * unmounts. This keeps Birds' dark-mode palette (indigo/violet
 * gradient over stars) in place while the Birds chrome is still
 * visible on either side of the swap.
 *
 * `LocationDisabledIndicator` (floating variant) is mounted alongside
 * Stars because the sky map has no natural "above the content" slot.
 * Birds mode mounts its own inline variant directly above the
 * BirdexGrid, so we don't render it here.
 */
const Index = () => {
  const { mode } = useMode();
  const isDark = useIsDark();

  // The mode at the very first render. Used to tell `ModeLayer`
  // whether to skip its fade-in on mount — the initial-mode layer
  // should appear instantly on page load; any layer that mounts later
  // (from a toggle click) should fade in from 0. Stored in state
  // (with a lazy initializer) rather than a ref so it can be read
  // during render without tripping the "refs during render" rule;
  // the setter is never called, so the value is effectively a
  // render-safe constant.
  const [initialMode] = useState<Mode>(() => mode);

  // Which modes' React trees are currently mounted. Normally a single
  // mode; during a cross-fade both are here for TRANSITION_MS.
  const [mountedModes, setMountedModes] = useState<Set<Mode>>(
    () => new Set([mode]),
  );
  // Which mode is the *target*: the one fading in (or already shown).
  // Used to drive opacity.
  const [targetMode, setTargetMode] = useState<Mode>(mode);

  // When the parent-owned `mode` prop changes, adjust our local state
  // during render rather than in an effect. This is the pattern
  // recommended by the React docs ("Adjusting some state when a prop
  // changes") and avoids the cascading re-render that an effect-based
  // setState would cause.
  if (mode !== targetMode) {
    setMountedModes((prev) => {
      if (prev.has(mode)) return prev;
      const next = new Set(prev);
      next.add(mode);
      return next;
    });
    setTargetMode(mode);
  }

  // After the fade completes, drop the outgoing mode so we aren't
  // running both trees' effects indefinitely. Keyed on `targetMode`
  // so a new timer fires each time a transition starts; the cleanup
  // cancels any still-pending timer from a previous, not-yet-settled
  // swap (e.g. user toggles twice in quick succession).
  useEffect(() => {
    const id = window.setTimeout(() => {
      setMountedModes(new Set([targetMode]));
    }, TRANSITION_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [targetMode]);

  // The backdrop is *the* visible sky only in dark Birds. In Stars the
  // interactive `<SkyMap>` paints its own opaque sky on top. We also
  // want it visible throughout any transition that starts from or ends
  // in dark Birds, so the outgoing side of the fade has a starry base.
  //
  // Rule: visible iff dark-themed AND Birds is in the mounted set.
  // - Dark Birds steady: mounted={birds}, isDark=true → true. ✓
  // - Stars steady: mounted={stars}, isDark=true (ForceDarkTheme) → false. ✓
  // - Dark Birds → Stars: mounted={birds,stars}, isDark=true → true
  //   during the transition, falls to false only once Birds unmounts
  //   at t=TRANSITION_MS. The backdrop then fades out (see `backdropMounted`
  //   defer below), bridging the swap with continuous stars.
  // - Stars → Dark Birds: mounted={stars,birds}, isDark=true → true.
  //   Backdrop fades in under Stars' fade-out; continuous stars. ✓
  // - Light Birds ↔ Stars: mounted contains birds+stars at some point
  //   but isDark is false during Birds phases, so backdrop stays
  //   hidden. Stars' own SkyMap fades in over pastel.
  const backdropVisible = isDark && mountedModes.has("birds");

  // Keep the `<SkyMap>` canvas mounted through the fade-out so the
  // wrapper's opacity transition has real stars to animate, not a
  // black rectangle. Trails `backdropVisible` by TRANSITION_MS on its
  // way down; follows immediately on the way up.
  const [backdropMounted, setBackdropMounted] = useState(backdropVisible);

  // Rising edge: adjust during render (React-recommended pattern) so
  // the canvas is already mounted on the same commit that flips the
  // wrapper to opacity 1.
  if (backdropVisible && !backdropMounted) {
    setBackdropMounted(true);
  }

  // Falling edge: delay the unmount by TRANSITION_MS so the opacity
  // transition has something to animate. If `backdropVisible` flips
  // back to true before the timer fires, the effect's cleanup cancels
  // the pending unmount — so we don't rip the canvas out from under
  // a not-yet-complete fade-in.
  useEffect(() => {
    if (backdropVisible) return;
    const id = window.setTimeout(() => {
      setBackdropMounted(false);
    }, TRANSITION_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [backdropVisible]);

  // Stars mode wants the `dark` class pinned on <html> throughout its
  // visible lifetime — including the fade-in.
  const needsForceDark = mountedModes.has("stars");

  const birdsVisible = targetMode === "birds";
  const starsVisible = targetMode === "stars";

  return (
    <>
      {needsForceDark ? <ForceDarkTheme /> : null}

      {/* Shared sky backdrop — fixed, behind everything. Persists
          across mode changes so the starfield stays rock-steady while
          the chrome cross-fades. */}
      <div
        className="fixed inset-0 -z-10"
        style={fadeStyle(backdropVisible)}
        aria-hidden
      >
        <SkyBackdrop hidden={!backdropMounted} />
      </div>

      {mountedModes.has("birds") ? (
        <ModeLayer
          key="birds"
          visible={birdsVisible}
          initiallyVisible={initialMode === "birds"}
        >
          <BirdsIndex />
        </ModeLayer>
      ) : null}

      {mountedModes.has("stars") ? (
        <ModeLayer
          key="stars"
          visible={starsVisible}
          initiallyVisible={initialMode === "stars"}
        >
          <StarsIndex />
          <LocationDisabledIndicator />
        </ModeLayer>
      ) : null}
    </>
  );
};

export default Index;
