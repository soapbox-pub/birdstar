import { useEffect, useRef, useState } from "react";

interface WakeLockSentinel extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockAPI {
  request(type: "screen"): Promise<WakeLockSentinel>;
}

/**
 * Hold a screen wake lock while `enabled` is true. This keeps the phone
 * from dimming or sleeping while the user is actively stargazing.
 *
 * Silently no-ops on browsers without the Screen Wake Lock API.
 * Automatically re-acquires the lock when the page becomes visible again
 * (a lock is released by the browser when the tab backgrounds).
 */
export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const acquire = async () => {
      if (!enabled) return;
      const nav = navigator as unknown as { wakeLock?: WakeLockAPI };
      if (!nav.wakeLock?.request) return;
      try {
        const s = await nav.wakeLock.request("screen");
        if (cancelled) {
          s.release().catch(() => {});
          return;
        }
        sentinelRef.current = s;
        setActive(true);
        s.addEventListener("release", () => {
          if (sentinelRef.current === s) {
            sentinelRef.current = null;
            setActive(false);
          }
        });
      } catch {
        // User may have denied, page hidden, etc. Silent failure is fine.
      }
    };

    const release = async () => {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      setActive(false);
      if (s && !s.released) {
        try {
          await s.release();
        } catch {
          // ignore
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && enabled && !sentinelRef.current) {
        acquire();
      }
    };

    if (enabled) {
      acquire();
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled]);

  return { active };
}
